import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { CohereEmbeddings } from "@langchain/cohere";
import { Pinecone as PineconeClient } from "@pinecone-database/pinecone";
import { CheerioWebBaseLoader } from "@langchain/community/document_loaders/web/cheerio";
import "dotenv/config";

export async function webFileEmbedding() {
  const urls = [
    "https://lilianweng.github.io/posts/2023-03-15-prompt-engineering/",
    "https://lilianweng.github.io/posts/2023-06-23-agent/",
  ];

  const documentsArray = await Promise.all(
    urls.map(async (url) => {
      const loader = new CheerioWebBaseLoader(url);
      const docs = await loader.load();
      console.log(url, "loaded:", docs.length);
      return docs;
    }),
  );

  const docs = documentsArray.flat().filter((d) => {
    const c = (d.pageContent || "").trim();
    if (!c) console.warn("Skipping empty doc:", d.metadata);
    return c.length > 0;
  });

  if (docs.length === 0)
    throw new Error("No documents were loaded with content.");

  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });

  const allSplits = await textSplitter.splitDocuments(docs);
  console.log("Total splits:", allSplits.length);
  if (allSplits.length === 0)
    throw new Error("Documents loaded, but no chunks were produced.");

  const embeddings = new CohereEmbeddings({
    model: "embed-english-v3.0",
    apiKey: process.env.COHERE_API_KEY,
  });

  const pinecone = new PineconeClient({
    apiKey: process.env.PINECONE_API_KEY,
  });
  const indexName = process.env.PINECONE_DENSE_INDEX || "langgraph-rag-dense";
  const pineconeIndex = pinecone.Index(indexName);

  const texts = allSplits.map((d) => d.pageContent);
  const vectors = await embeddings.embedDocuments(texts);

  const records = [];
  for (let i = 0; i < allSplits.length; i++) {
    const v = vectors[i];
    if (Array.isArray(v) && v.length > 0) {
      records.push({
        id: `doc_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 8)}`,
        values: v,
        metadata: {
          text: allSplits[i].pageContent.slice(0, 30000),
          source: allSplits[i].metadata?.source || "",
        },
      });
    }
  }

  console.log("Records to upsert:", records.length);
  if (records.length === 0) {
    throw new Error("No upsert records generated.");
  }

  const batchSize = 25;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);

    await pineconeIndex.upsert({
      records: batch,
    });

    console.log(`Upserted ${i + batch.length}/${records.length}`);
  }

  console.log("finished embedding..., webfile");
}

await webFileEmbedding();
