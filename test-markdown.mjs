import { createRepository } from "./src/sdd/persistence/repository.js"
import { MarkdownRepository } from "./src/sdd/persistence/markdown.js"
import { migrateToMarkdown } from "./src/sdd/migrations/migrate-to-markdown.js"

const repo = createRepository(process.cwd())
console.log('Repo initialized:', repo.isInitialized())
if (repo.isInitialized()) {
  const graph = repo.loadGraph()
  console.log('Graph nodes:', graph.nodes.length)
  console.log('Graph relationships:', graph.relationships.length)

  const mdRepo = new MarkdownRepository(process.cwd())
  console.log('Markdown files:', mdRepo.listAll())

  const report = migrateToMarkdown(process.cwd())
  console.log('Migration report:', JSON.stringify(report, null, 2))
}