import {
  START,
  END,
  StateGraph,
  Annotation,
  MessagesAnnotation,
} from "@langchain/langgraph";
import { createAgent } from "langchain";
import { z } from "zod";
import { AIMessage, HumanMessage } from "langchain";
import { retriever } from "./../retriever.js";
import {
  QUERY_REWRITE_PROMPT,
  SYNTENSIS_RESPONSE_PROMPT,
  CATEGORIZATION_SYSTEM_PROMPT,
  GRADE_SYSTEM_PROMPT,
} from "./prompts.js";
import { ChatCerebras } from "@langchain/cerebras";
// import { ChatOpenAI } from "@langchain/openai";
import "dotenv/config";

const model = new ChatCerebras({
  model: "gpt-oss-120b",
  temperature: 0.7,
  apiKey: process.env.CEREBRAS_API_KEY,
});

// const jevModel = new ChatOpenAI({
//   model: "jev-1.13-free",
//   temperature: 0.7,
//   apiKey: process.env.BEATAPI_API_KEY,
// });

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
});

// Nodes

const queryAnalysisNode = async function (state) {
  console.log("queryAnalysisNode::::::::");
  const messageHistory = state.messages;

  // ::::::::::::::::::::::::: LLM Approach
  const structuredModel = model.withStructuredOutput(
    z
      .object({
        nextNode: z.enum(["QUERY_REWRITE", "OUT_OF_SCOPE"]),
      })
      .describe("next node to route to"),
  );

  const result = await structuredModel.invoke([
    {
      role: "system",
      content: CATEGORIZATION_SYSTEM_PROMPT,
    },
    ...messageHistory,
  ]);

  return { nextNode: result.nextNode };

  // ::::::::::::::::::::::::: JEV APPROACH
  /*
  const lastHumanMessage = messageHistory
    .filter((message) => message._getType() === "human")
    .at(-1);

  const response = await fetch("https://api.beatapi.io/v1/systemone", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.BEATAPI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "jev-1.13-free",
      state: {
        user_question: lastHumanMessage?.content,
      },
      questions: {
        routing: {
          type: "choice",
          instructions: CATEGORIZATION_SYSTEM_PROMPT,
          criteria: {
            QUERY_REWRITE:
              "The user's question is relevant to the supported subject area and should be processed by the RAG pipeline.",
            OUT_OF_SCOPE:
              "The user's question is unrelated to the supported subject area and should not be processed by the RAG pipeline.",
          },
        },
      },
    }),
  });

  if (!response.ok)
    throw new Error(
      `BeatAPI request failed: ${response.status} ${response.statusText}`,
    );

  const result = await response.json();
  const nextNode = result?.answers?.routing?.choice;

  if (!["QUERY_REWRITE", "OUT_OF_SCOPE"].includes(nextNode))
    throw new Error(`Invalid Jev routing result: ${nextNode}`);

  console.log("JEV DECISION::::::::::: ", nextNode);
  return { nextNode };
  */
};

const queryRewriterNode = async function (state) {
  console.log("queryRewriterNode::::::::");
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

  if (state.rewriteQueries.length === 3) return { nextNode: "generatorNode" };

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
        ${state.rewriteQueries.join("\n")}
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
  return { messages: [aiResponse] };
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

// GRAPH
const builder = new StateGraph(StateAnnotation)
  .addNode("queryAnalysisNode", queryAnalysisNode)
  .addNode("queryRewriterNode", queryRewriterNode)
  .addNode("retrieverNode", retrieverNode)
  .addNode("graderNode", graderNode)
  .addNode("generatorNode", generatorNode)
  .addNode("outOfScopeNode", outOfScopeNode)

  .addEdge(START, "queryAnalysisNode")
  .addConditionalEdges("queryAnalysisNode", (state) => state.nextNode, {
    QUERY_REWRITE: "queryRewriterNode",
    OUT_OF_SCOPE: "outOfScopeNode",
  })
  .addConditionalEdges("queryRewriterNode", (state) => state.nextNode, {
    retrieverNode: "retrieverNode",
    generatorNode: "generatorNode",
  })
  .addEdge("retrieverNode", "graderNode")
  .addConditionalEdges("graderNode", (state) => state.nextNode, {
    queryRewriterNode: "queryRewriterNode",
    generatorNode: "generatorNode",
  })

  .addEdge("generatorNode", END)
  .addEdge("outOfScopeNode", END);

const graph = builder.compile();
const result = await graph.invoke({
  messages: [new HumanMessage({ content: "What is chain of thoughts?" })],
  // messages: [new HumanMessage({ content: "What is corrective rag?" })],
});

console.log("FINAL RESPONSE:-------> ", result);
console.log(graph.getGraph().drawMermaid());
