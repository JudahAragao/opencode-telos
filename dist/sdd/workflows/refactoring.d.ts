import type { KnowledgeGraph, ChangeNode, RefactoringNode } from '../domain/types.js';
export interface RefactoringWorkflow {
    id: string;
    target_module: string;
    description: string;
    refactoring_type: 'extract' | 'rename' | 'move' | 'simplify' | 'restructure';
    files: string[];
}
export declare function createRefactoringChange(_graph: KnowledgeGraph, workflow: RefactoringWorkflow): {
    change: ChangeNode;
    refactoring: RefactoringNode;
};
export declare function getRefactoringInstructions(refactoring: RefactoringNode): string;
