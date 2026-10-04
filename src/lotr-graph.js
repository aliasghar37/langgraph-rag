import { Annotation, START, END, StateGraph } from "@langchain/langgraph";

const LOTRState = Annotation.Root({
  email: Annotation({
    reducer: (prev, next) => prev.concat(next),
    default: () => [],
  }),
  type: Annotation(),
});

const nodeBilbo = function () {
  console.log("Node Bilbo --->");
  return {
    email: "bilbo@lotr.com",
  };
};
const nodeFrodo = function () {
  console.log("Node Frodo --->");
  return {
    email: "frodo@lotr.com",
  };
};
const nodeSam = function () {
  console.log("Node Sam --->");
  return {
    email: "sam@lotr.com",
  };
};

const nodeSauron = function () {
  console.log("Node Sauron --->");
  return {
    email: "sauron@lotr.com",
  };
};
const nodeSauruman = function () {
  console.log("Node Sauruman --->");
  return {
    email: "sauruman@lotr.com",
  };
};

const nodeAragorn = function () {
  console.log("Node Aragorn --->");
  return {
    email: "aragorn@lotr.com",
  };
};
const nodeBoromir = function () {
  console.log("Node Boromir --->");
  return {
    email: "boromir@lotr.com",
  };
};
const nodeFaramir = function () {
  console.log("Node Faramir --->");
  return {
    email: "faramir@lotr.com",
  };
};

const router = function (state) {
  if (state.type === "hobbit") {
    return "nodeBilbo";
  } else if (state.type === "villian") {
    return "nodeSauron";
  } else if (state.type === "human") {
    return "nodeAragorn";
  }
  throw new Error("Unknown character type");
};

const builder =
  // villians route sequence
  new StateGraph(LOTRState)
    .addNode("nodeBilbo", nodeBilbo)
    .addNode("nodeFrodo", nodeFrodo)
    .addNode("nodeSam", nodeSam)
    .addNode("nodeSauron", nodeSauron)
    .addNode("nodeSauruman", nodeSauruman)
    .addNode("nodeAragorn", nodeAragorn)
    .addNode("nodeBoromir", nodeBoromir)
    .addNode("nodeFaramir", nodeFaramir)

    .addConditionalEdges(START, router, [
      "nodeBilbo",
      "nodeSauron",
      "nodeAragorn",
    ])

    // Hobbit route sequeunce
    .addEdge("nodeBilbo", "nodeFrodo")
    .addEdge("nodeFrodo", "nodeSam")
    .addEdge("nodeSam", END)

    // Villians route sequence
    .addEdge("nodeSauron", "nodeSauruman")
    .addEdge("nodeSauruman", END)

    // Humans route sequeunce
    .addEdge("nodeAragorn", "nodeBoromir")
    .addEdge("nodeBoromir", "nodeFaramir")
    .addEdge("nodeFaramir", END);

// Compilation of graph
const graph = builder.compile();
// invoking it
const baseResult = await graph.invoke({
  type: "hobbit",
});
console.log(baseResult);
console.log(graph.getGraph().drawMermaid());
