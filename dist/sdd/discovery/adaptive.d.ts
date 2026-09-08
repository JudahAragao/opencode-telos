import type { KnowledgeGraph } from "../domain/types.js";
import type { QuestionForUser } from "./briefing.js";
/**
 * Given a list of discovery questions and the current graph state,
 * filter out questions that are already answered by existing graph data.
 * This prevents redundant questions in brownfield projects.
 */
export declare function filterAlreadyAnswered(questions: QuestionForUser[], graph: KnowledgeGraph): QuestionForUser[];
/**
 * Generate context-aware questions based on graph gaps.
 * Instead of generic questions, ask about what's actually missing.
 */
export declare function generateGapQuestions(graph: KnowledgeGraph): QuestionForUser[];
