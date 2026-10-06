import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { ExaSearchResults } from "@langchain/exa";
import Exa from "exa-js";
import "dotenv/config";

const client = new Exa(process.env.EXASEARCH_API_KEY);
export const webSearchTool = tool(
  async ({ query }) => {
    const exaTool = new ExaSearchResults({
      client,
      searchArgs: {
        numResults: 1,
        type: "neural",
      },
    });

    const result = await exaTool.invoke(query);
    return result;
  },
  {
    name: "webSearchTool",
    description: "Search the web to find real-time and up-to-date information.",
    schema: z.object({
      query: z.string(),
    }),
  },
);
