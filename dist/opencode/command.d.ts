import type { Hooks } from "@opencode-ai/plugin";
/**
 * Command hub interativo para SDD.
 *
 * O plugin registra um handler no hook `command.execute.before`.
 * Quando o OpenCode vê um comando `sdd <subcommand>` (ou `sdd:<subcommand>`),
 * antes de qualquer execução, o hook intercepta e executa a ação correspondente
 * de forma determinística — sem depender do LLM.
 *
 * Essa é a "tela interativa nova" nesse estágio: um único atalho `sdd` que
 * roteia para os subcomandos comuns. O atalho `sdd` pode ser invocado como
 * `/sdd`, `/sdd on`, `/sdd status`, `/sdd cache_reset` (ou qualquer forma
 * que o runtime normalize como um command `sdd`).
 *
 * "Exibir na tela inicial" é, na prática, registros de comando. O sistema
 * do OpenCode já reconhece comandos setup (ex: via `~/.config/opencode/command/`),
 * e o plugin pode anexar uma mensagem de ajuda ao detectar um command
 * desconhecido/auxiliar. Aqui deixamos essa mensagem disponível e usamos
 * o roteamento determinístico.
 */
export interface SddCommandInput {
    command: string;
    sessionID: string;
    arguments: string;
}
import type { Part } from "@opencode-ai/sdk";
export interface SddCommandOutput {
    parts: Part[];
}
/**
 * Detecta comandos SDD e os executa de forma determinística.
 *
 * Escolhemos `command.execute.before` porque é o hook público do SDK 1.18 que
 * corresponde à chegada de um command do TUI antes de sua execução. O hook
 * permite interceptar e substituir o comportamento de comandos reconhecidos
 * (neste caso, o command `sdd`), sem depender do chat.message/LLM.
 */
export declare function createSddCommandHooks(projectDir: string): Hooks;
