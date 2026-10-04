import { CohereEmbeddings } from "@langchain/cohere";
import { PineconeStore } from "@langchain/pinecone";
import { Pinecone as PineconeClient } from "@pinecone-database/pinecone";
import "dotenv/config";

export async function retriever(query) {
  const embeddings = new CohereEmbeddings({
    model: "embed-english-v3.0",
    apiKey: process.env.COHERE_API_KEY,
  });

  const pinecone = new PineconeClient({
    apiKey: process.env.PINECONE_API_KEY,
  });
  const indexName = process.env.PINECONE_DENSE_INDEX || "langgraph-rag-dense";
  const pineconeIndex = pinecone.Index(indexName);

  const vectorStore = new PineconeStore(embeddings, {
    pineconeIndex,
    maxConcurrency: 5,
  });

  const result = await vectorStore.similaritySearch(query, 5);

  return result;
}
