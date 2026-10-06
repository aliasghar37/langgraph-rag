import {
  END,
  START,
  StateGraph,
  Annotation,
  MessagesAnnotation,
} from "@langchain/langgraph";
import { createAgent } from "langchain";
import { z } from "zod";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { Document } from "@langchain/core/documents";

import {
  HALLUCINATION_CHECKER_PROMPT,
  QUERY_ANALYSIS_SYSTEM_PROMPT,
  QUERY_REWRITE_PROMPT,
  GRADE_SYSTEM_PROMPT,
  SYNTENSIS_RESPONSE_PROMPT,
  CATEGORIZATION_SYSTEM_PROMPT,
} from "./prompts.js";
import { retriever } from "./../retriever.js";
import { tool } from "@langchain/core/tools";
import { ChatCerebras } from "@langchain/cerebras";
import { ExaSearchResults } from "@langchain/exa";
import Exa from "exa-js";
import "dotenv/config";

const model = new ChatCerebras({
  model: "gpt-oss-120b",
  temperature: 0.7,
  apiKey: process.env.CEREBRAS_API_KEY,
});

const formatDocumentsAsString = (documents) => {
  return documents.map((doc) => doc?.pageContent).join("\n\n");
};

// State
const StateAnnotation = Annotation.Root({
  ...MessagesAnnotation.spec,
  rewriteQueries: Annotation({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  nextNode: Annotation({
    default: () => null,
  }),
  retrievedDocuments: Annotation({
    reducer: (_, y) => y,
    default: () => [],
  }),
  generatedAnswer: Annotation({
    default: () => null,
  }),
});

const queryAnalysisNode = async function (state) {
  console.log("queryAnalysisNode::::::::");
  const messageHistory = state.messages;

  const structuredModel = model.withStructuredOutput(
    z
      .object({
        nextNode: z.enum(["WEB_SEARCH", "VECTOR_STORE"]),
      })
      .describe("next node to route to"),
  );

  const result = await structuredModel.invoke([
    {
      role: "system",
      content: QUERY_ANALYSIS_SYSTEM_PROMPT,
    },
    ...messageHistory,
  ]);

  return { nextNode: result.nextNode };
};

const initialNode = async (state) => {
  const messageHistory = state.messages;

  const structuredLlm = model.withStructuredOutput(
    z
      .object({
        nextNode: z.enum(["QUERY_REWRITE", "OUT_OF_SCOPE"]),
      })
      .describe("nextnode to route to"),
  );

  const result = await structuredLlm.invoke([
    {
      role: "system",
      content: CATEGORIZATION_SYSTEM_PROMPT,
    },
    ...messageHistory,
  ]);

  return { nextNode: result?.nextNode };
};

const queryRewriterNode = async function (state) {
  console.log("queryRewriterNode::::::::");

  if (state.rewriteQueries.length === 2)
    return { nextNode: "webSearchNode", retrievedDocuments: [] };

  const lastMessage = state.messages
    .filter((m) => m._getType("human"))
    .slice(-1)[0];

  const structuredLlm = model.withStructuredOutput(
    z
      .object({ questions: z.array(z.string()).length(1) })
      .describe("rewrite queries"),
  );
  const result = await structuredLlm.invoke([
    { role: "ai", content: QUERY_REWRITE_PROMPT },
    { role: "human", content: lastMessage?.content },
  ]);

  const questions = result?.questions;
  return { nextNode: "retrieverNode", rewriteQueries: [...questions] };
};

const retrieverNode = async function (state) {
  console.log("retrieverNode::::::::");

  const query = state.rewriteQueries.at(-1);
  const documents = await retriever(query);

  return { nextNode: "generatorNode", retrievedDocuments: documents };
};

const generatorNode = async function (state) {
  console.log("generatorNode::::::::");
  const lastMessage = state.messages
    .filter((msg) => msg._getType() === "human")
    .slice(-1)[0];
  const agent = createAgent({ model, systemPrompt: SYNTENSIS_RESPONSE_PROMPT });

  const retrievedDocToString = formatDocumentsAsString(
    state.retrievedDocuments,
  );
  const agentOutput = await agent.invoke({
    messages: [
      new HumanMessage({
        content: `
        User Question:
        <user_questions>
        ${state.rewriteQueries.join("\n") || lastMessage?.content}
        </user_questions>
        
        Retrieved Data:
        <retrieved_data>
        ${retrievedDocToString}
        </retrieved_data>
        `,
      }),
    ],
  });
  const aiResponse = agentOutput.messages.at(-1);
  return { generatedAnswer: aiResponse, messages: [aiResponse] };
};

const outOfScopeNode = async function (state) {
  console.log("outOfScopeNode::::::::");
  const aiResponse = new AIMessage({
    content: "Sorry, I can't assist you in that",
  });
  return { messages: [aiResponse] };
};

const graderNode = async function (state) {
  console.log("graderNode::::::::");
  const structuredLlm = model.withStructuredOutput(
    z.object({
      binaryScore: z
        .enum(["yes", "no"])
        .describe("Relevance score 'yes' or 'no'"),
    }),
  );

  const formatDocsToString = formatDocumentsAsString(state.retrievedDocuments);

  const result = await structuredLlm.invoke([
    { role: "ai", content: GRADE_SYSTEM_PROMPT },
    {
      role: "human",
      content: `
        User Question: 
        <user_question>
        ${state.rewriteQueries.join("\n")}
        </user_question>
        
        Retrieved Date:
        <retrieved_data>
        ${formatDocsToString}
        </retrieved_data>
        `,
    },
  ]);
  const score = result?.binaryScore;
  console.log("graderNode Score:::::::: ", score);

  if (score === "yes") return { nextNode: "generatorNode" };
  return { nextNode: "queryRewriterNode" };
};

const webSearchNode = async function (state) {
  const client = new Exa(process.env.EXASEARCH_API_KEY);
  const lastMessage = state.messages
    .filter((msg) => msg._getType() === "human")
    .slice(-1)[0];

  const webSearchTool = tool(
    async ({ query }) => {
      const exaTool = new ExaSearchResults({
        client,
        searchArgs: { numResults: 1, type: "neural" },
      });
      const result = await exaTool.invoke(query);
      return result;
    },
    {
      name: "search_web",
      description:
        "Search the web to find real-time and up-to-date information",
      schema: z.object({
        query: z.string(),
      }),
    },
  );

  const lastQuery = state.rewriteQueries.at(-1) || lastMessage?.content;
  // const result = await webSearchTool.invoke({ query: lastQuery });
  const result = JSON.parse(await webSearchTool.invoke({ query: lastQuery }));

  // console.log("Web Search Result::::::: ", result);
  console.log(
    "Web Search Completed >results::::::: ",
    result.results?.length ?? 0,
  );

  const docs = new Document({
    pageContent: (result.results ?? [])
      .map(
        ({ title, url, text }) =>
          `Title: ${title}\nSource: ${url}\n\n${text?.slice(0, 4000)}`,
      )
      .join("\n\n"),
  });
  return { retrievedDocuments: [docs] };
};

const hallucinationChecker = async function (state) {
  console.log("Hallucination Checker::::::::");
  const lastMessage = state.messages
    .filter((msg) => msg._getType() === "human")
    .slice(-1)[0];

  const structuredLlm = model.withStructuredOutput(
    z.object({
      hallucination: z.enum(["yes", "no"]),
    }),
  );

  const result = await structuredLlm.invoke([
    {
      role: "ai",
      content: HALLUCINATION_CHECKER_PROMPT,
    },
    {
      role: "user",
      content: `
      User Question:
      <user_questions>
        ${state.rewriteQueries.join("\n") || lastMessage?.content}
      </user_questions>
            
      Generated Answer:
      <generated_answer>
        ${state.generatedAnswer}
      </generated_answer>
      `,
    },
  ]);
  const res = result?.hallucination;
  if (res === "yes") {
    console.log("....rewrite....");
    return { nextNode: "QUERY_REWRITE" };
  }
  if (res === "no") return { nextNode: "END" };
};

// GRAPH

const builder = new StateGraph(StateAnnotation)
  .addNode("initialNode", initialNode)
  .addNode("queryAnalysisNode", queryAnalysisNode)
  .addNode("queryRewriterNode", queryRewriterNode)
  .addNode("retrieverNode", retrieverNode)
  .addNode("graderNode", graderNode)
  .addNode("generatorNode", generatorNode)
  .addNode("outOfScopeNode", outOfScopeNode)
  .addNode("webSearchNode", webSearchNode)
  .addNode("hallucinationChecker", hallucinationChecker)

  .addEdge(START, "queryAnalysisNode")
  .addConditionalEdges("queryAnalysisNode", (state) => state.nextNode, {
    WEB_SEARCH: "webSearchNode",
    VECTOR_STORE: "initialNode",
  })

  .addConditionalEdges("initialNode", (state) => state.nextNode, {
    QUERY_REWRITE: "queryRewriterNode",
    OUT_OF_SCOPE: "outOfScopeNode",
  })

  .addConditionalEdges("queryRewriterNode", (state) => state.nextNode, {
    retrieverNode: "retrieverNode",
    webSearchNode: "webSearchNode",
  })

  .addEdge("retrieverNode", "graderNode")
  .addConditionalEdges("graderNode", (state) => state.nextNode, {
    queryRewriterNode: "queryRewriterNode",
    generatorNode: "generatorNode",
  })

  .addConditionalEdges("hallucinationChecker", (state) => state.nextNode, {
    QUERY_REWRITE: "queryRewriterNode",
    END: END,
  })

  .addEdge("webSearchNode", "generatorNode")
  .addEdge("generatorNode", "hallucinationChecker")
  .addEdge("outOfScopeNode", END);

const graph = builder.compile();

const result = await graph.invoke({
  messages: [new HumanMessage({ content: "What is prompt engineering?" })],
});

// console.log("FINAL RESPONSE::::::::}> ", result);
console.log("FINAL RESPONSE::::::::}> ", result.generatedAnswer.content);
console.log(graph.getGraph().drawMermaid());
