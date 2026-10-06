import {
  END,
  START,
  StateGraph,
  Annotation,
  MessagesAnnotation,
  Command,
} from "@langchain/langgraph";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { createAgent } from "langchain";
import { ChatCerebras } from "@langchain/cerebras";
import { webSearchTool } from "./tools.js";
import {
  managerPrompt,
  researcherPrompt,
  summarizerPrompt,
} from "./prompts.js";
import "dotenv/config";

const model = new ChatCerebras({
  model: "gpt-oss-120b",
  temperature: 0.7,
  apiKey: process.env.CEREBRAS_API_KEY,
});

async function createAgentNode({
  systemPrompt,
  message,
  agentTools = [],
  config,
}) {
  const agent = createAgent({
    model,
    tools: agentTools,
    systemPrompt,
  });

  const result = await agent.invoke(
    { messages: [new HumanMessage(message)] },
    config,
  );

  return result.messages[result.messages.length - 1];
}

const StateAnnotation = Annotation.Root({
  ...MessagesAnnotation.spec,
  nextNode: Annotation(),
});

const managerAgent = async (state) => {
  console.log("managerAgent:::::::::::::::");

  const last = state.messages
    .filter((m) => m._getType() === "human")
    .slice(-1)[0];

  const aiMessage = await createAgentNode({
    systemPrompt: managerPrompt,
    message: last?.content,
  });

  const shouldHandoff = aiMessage?.content?.includes("__REQUEST__");

  if (shouldHandoff)
    return new Command({
      update: { messages: [new AIMessage(aiMessage?.content)] },
      goto: "researcherAgent",
    });

  return new Command({
    update: { messages: [new AIMessage(aiMessage?.content)] },
    goto: END,
  });
};

const researcherAgent = async (state) => {
  console.log("researcherNode:::::::::::::::");
  const last = state.messages.filter((m) => m._getType() === "ai").slice(-1)[0];

  const aiMessage = await createAgentNode({
    systemPrompt: researcherPrompt,
    message: last?.content,
    agentTools: [webSearchTool],
  });

  return new Command({
    update: { messages: [new AIMessage(aiMessage?.content)] },
    goto: "summarizerAgent",
  });
};

const summarizerAgent = async (state) => {
  console.log("summarizerAgent:::::::::::::::");
  const last = state.messages.filter((m) => m._getType() === "ai").slice(-1)[0];

  const aiMessage = await createAgentNode({
    systemPrompt: summarizerPrompt,
    message: last?.content,
  });

  return new Command({
    update: { messages: [aiMessage] },
    goto: END,
  });
};

// Graph
const workflow = new StateGraph(StateAnnotation)
  .addNode("managerAgent", managerAgent, {
    ends: ["researcherAgent", END],
  })
  .addNode("researcherAgent", researcherAgent, {
    ends: ["summarizerAgent"],
  })
  .addNode("summarizerAgent", summarizerAgent, {
    ends: [END],
  })
  .addEdge(START, "managerAgent");

const graph = workflow.compile();
const result = await graph.invoke({
  // messages: [new HumanMessage("Hello!")],
  messages: [new HumanMessage("what is the current weather in new york?")],
});

console.log("Final Graph Result::::::::: ", result);
console.log(graph.getGraph().drawMermaid());
