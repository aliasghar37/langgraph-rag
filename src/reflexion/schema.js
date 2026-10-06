import { z } from "zod";

// Schema for structured reflection
const ReflectionSchema = z.object({
  missing: z.string().describe("Critique of what is missing."),
  superfluous: z.string().describe("Critique of what is superfluous"),
});

// Main response schema
const AnswerQuestionSchema = z.object({
  answer: z.string().describe("~250 word detailed answer to the question."),
  reflection: ReflectionSchema,
  search_queries: z
    .array(z.string())
    .describe("1-3 search queries for researching improvements."),
});

// Schema for revision (adds references)
const ReviseAnswerSchema = AnswerQuestionSchema.extend({
  references: z
    .array(z.string())
    .describe("Citations motivating your updated answer."),
});

export { ReflectionSchema, AnswerQuestionSchema, ReviseAnswerSchema };
