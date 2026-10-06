# LangGraph RAG

A hands-on learning project exploring **LangGraph**, advanced **Retrieval-Augmented Generation (RAG)**, and **agentic systems** using JavaScript.

## Key Concepts

- LangGraph state, nodes, edges, and conditional routing
- Multi-Agent System using handoff pattern
- `Command`-based agent handoffs
- Vector-store retrieval with Pinecone
- Web search with Exa
- Structured LLM output with Zod
- Agent creation with `createAgent()`
- Query rewriting and document grading
- Hallucination detection
- Reflection and answer revision
- Manage message history between graph nodes
- Design RAG pipelines that can evaluate and improve their own responses

## RAG Implementations

### Naive RAG

Basic retrieval followed by answer generation.

- [`src/naive-rag/rag.js`](./src/naive-rag/rag.js)

### Corrective RAG

Grades retrieved documents and takes corrective action when results are not useful.

- [`src/crag/crag1.js`](./src/crag/crag1.js)
- [`src/crag/crag2.js`](./src/crag/crag2.js)

### Self-RAG

LLM does self-evaluation and self-reflection of the generated answer for hallucinations.

- [`src/self-rag/self-rag.js`](./src/self-rag/self-rag.js)

### Adaptive RAG

Retrieve and generate information from diverse data sources by combining query analysis with an active/self-modifying RAG.

- [`src/adaptive-rag/adaptive-rag.js`](./src/adaptive-rag/adaptive-rag.js)

### Reflection and Reflexion

Reflection asks the model to review and critique a generated answer and Reflexion extends reflection by using the critique to improve the answer.

- [`src/reflection/reflection.js`](./src/reflection/reflection.js)
- [`src/reflexion/reflexion.js`](./src/reflexion/reflexion.js)

### Multi-Agent System using Handoff Pattern

The multi-agent workflow using Handoff pattern demonstrates how agents can delegate tasks to one another using LangGraph `Command`.

- [`src/handoff-pattern/multi-agent-system.js`](./src/handoff-pattern/multi-agent-system.js)

## Architecture

<details>
  <summary><strong>View architecture diagrams</strong></summary>
  
  <br />

  <img src="./src/diagrams.png" alt="LangGraph RAG Architecture" width="900"/>

</details>
