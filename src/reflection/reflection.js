import {
  END,
  START,
  StateGraph,
  Annotation,
  MessagesAnnotation,
} from "@langchain/langgraph";
import { createAgent } from "langchain";
import { HumanMessage } from "@langchain/core/messages";
import {
  GENERATION_ESSAY_POMPT,
  REFLECTION_POMPT,
  REVISION_PROMPT,
} from "./prompts.js";
import { ChatCerebras } from "@langchain/cerebras";
import "dotenv/config";

const model = new ChatCerebras({
  model: "gpt-oss-120b",
  temperature: 0.7,
  apiKey: process.env.CEREBRAS_API_KEY,
});

const StateAnnotation = Annotation.Root({
  ...MessagesAnnotation.spec,
  generatedEssay: Annotation({
    default: () => null,
  }),
  corrections: Annotation({
    default: () => null,
  }),
  finalEssay: Annotation({
    default: () => null,
  }),
});

const generatorNode = async (state) => {
  console.log("generatorNode:::::::::::::::");
  const messageHistory = state.messages;

  const result = await model.invoke([
    {
      role: "system",
      content: GENERATION_ESSAY_POMPT,
    },
    ...messageHistory,
  ]);
  const content = result?.content;

  return { nextNode: "reflectionNode", generatedEssay: content };
};

const reflectionNode = async (state) => {
  console.log("reflectionNode:::::::::::::::");
  const agent = createAgent({
    model,
    systemPrompt: REFLECTION_POMPT,
  });

  const agentOutput = await agent.invoke({
    messages: [
      new HumanMessage(
        `Generated Essay:
        <generated_essay>
        ${state.generatedEssay}
        </generated_essay>
      `,
      ),
    ],
  });

  const aiResponse =
    agentOutput.messages[agentOutput.messages.length - 1].content;

  return { corrections: aiResponse };
};

const generateFinalEssayNode = async (state) => {
  console.log("generateFinalEssayNode:::::::::::::::");
  const agent = createAgent({
    model,
    systemPrompt: REVISION_PROMPT,
  });

  const agentOutput = await agent.invoke({
    messages: [
      new HumanMessage(
        `
        Generated Essay:
        <generated_essay>
        ${state.generatedEssay}
        </generated_essay>

        Critics or corrections :
        <correction_to_apply>
        ${state.corrections}
        </correction_to_apply>
      `,
      ),
    ],
  });

  const aiResponse =
    agentOutput.messages[agentOutput.messages.length - 1].content;

  return { finalEssay: aiResponse };
};

const builder = new StateGraph(StateAnnotation)
  .addNode("generatorNode", generatorNode)
  .addNode("reflectionNode", reflectionNode)
  .addNode("generateFinalEssayNode", generateFinalEssayNode)

  .addEdge(START, "generatorNode")
  .addEdge("generatorNode", "reflectionNode")
  .addEdge("reflectionNode", "generateFinalEssayNode")
  .addEdge("generateFinalEssayNode", END);

const graph = builder.compile();
const result = await graph.invoke({
  messages: [
    new HumanMessage({
      content:
        "Write an essay on how Artificial Intelligence is shaping the future of work and society",
    }),
  ],
});
console.log("Final Graph Result::::::::: ", result);
console.log(graph.getGraph().drawMermaid());
