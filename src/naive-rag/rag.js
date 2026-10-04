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
import { retriever } from "./retriever.js";
import {
  QUERY_REWRITE_PROMPT,
  SYNTENSIS_RESPONSE_PROMPT,
  CATEGORIZATION_SYSTEM_PROMPT,
} from "./prompts.js";
import { ChatCerebras } from "@langchain/cerebras";
import { ChatOpenAI } from "@langchain/openai";
import "dotenv/config";

const model = new ChatCerebras({
  model: "gpt-oss-120b",
  temperature: 0.7,
  apiKey: process.env.CEREBRAS_API_KEY,
});

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
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
});

const formatDocumentsAsString = (documents) => {
  return documents.map((doc) => doc?.pageContent).join("\n\n");
};

// NOde functions

const queryAnalysisNode = async function (state) {
  console.log("queryAnalysisNode::::::::");
  const messageHistory = state.messages;

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
};

const queryRewriterNode = async function (state) {
  console.log("queryRewriterNode::::::::");
  const lastMessage = state.messages
    .filter((m) => m._getType("human"))
    .slice(-1)[0];

  const structuredLlm = model.withStructuredOutput(
    z
      .object({ questions: z.array(z.string()).length(3) })
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
  const retreivedDocs = [];
  for (const query of state.rewriteQueries) {
    const docs = await retriever(query);
    retreivedDocs.push(docs);
  }
  const flatten = retreivedDocs.flat();
  return { nextNode: "generatorNode", retrievedDocuments: [...flatten] };
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

  // console.log("FINAL RESPONSE:-------> ", aiResponse?.content);
  return { messages: [aiResponse] };
};

const outOfScopeNode = async function (state) {
  console.log("outOfScopeNode::::::::");
  const aiResponse = new AIMessage({
    content: "Sorry, I can't assist you in that",
  });
  return { messages: [aiResponse] };
};

// GRAPH

const builder = new StateGraph(StateAnnotation)
  .addNode("queryAnalysisNode", queryAnalysisNode)
  .addNode("queryRewriterNode", queryRewriterNode)
  .addNode("retrieverNode", retrieverNode)
  .addNode("generatorNode", generatorNode)
  .addNode("outOfScopeNode", outOfScopeNode)

  .addEdge(START, "queryAnalysisNode")
  .addConditionalEdges("queryAnalysisNode", (state) => state.nextNode, {
    QUERY_REWRITE: "queryRewriterNode",
    OUT_OF_SCOPE: "outOfScopeNode",
  })
  .addConditionalEdges(
    "queryRewriterNode",
    (state) => {
      return state.nextNode === "retrieverNode" ? "RETRIEVE" : "STOP";
    },
    {
      RETRIEVE: "retrieverNode",
      STOP: END,
    },
  )
  .addEdge("retrieverNode", "generatorNode")
  .addEdge("generatorNode", END)
  .addEdge("outOfScopeNode", END);

const graph = builder.compile();

const result = await graph.invoke({
  messages: [new HumanMessage({ content: "What is prompt engineering" })],
});

console.log("FINAL RESPONSE:-------> ", result);
console.log(graph.getGraph().drawMermaid());
