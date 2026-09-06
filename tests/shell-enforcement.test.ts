import { describe, it, expect } from "bun:test"
import { detectShellFileWrites } from "../src/opencode/hooks"

describe("Shell Command Enforcement", () => {
  describe("Python heredocs", () => {
    it("detects python3 heredoc with open().write()", () => {
      const cmd = `python3 - <<'EOF'
src = open('packages/core/src/content/service.ts').read()
open('packages/core/src/content/service.ts','w').write(src)
EOF`
      const files = detectShellFileWrites(cmd)
      expect(files).toContain("packages/core/src/content/service.ts")
    })

    it("detects python3 -c with open().write()", () => {
      const cmd = `python3 -c "open('src/index.ts','w').write('console.log(1)')"`
      const files = detectShellFileWrites(cmd)
      expect(files).toContain("src/index.ts")
    })

    it("detects multiple file writes in single heredoc", () => {
      const cmd = `python3 - <<'EOF'
open('src/a.ts','w').write('a')
open('src/b.ts','w').write('b')
EOF`
      const files = detectShellFileWrites(cmd)
      expect(files).toContain("src/a.ts")
      expect(files).toContain("src/b.ts")
    })
  })

  describe("Node.js eval", () => {
    it("detects node -e with writeFileSync", () => {
      const cmd = `node -e "require('fs').writeFileSync('src/utils.ts', 'export const x = 1')"`
      const files = detectShellFileWrites(cmd)
      expect(files).toContain("src/utils.ts")
    })
  })

  describe("Shell redirects", () => {
    it("detects cat > file.ts", () => {
      const cmd = `cat > src/app.ts <<'EOF'
export default {}
EOF`
      const files = detectShellFileWrites(cmd)
      expect(files).toContain("src/app.ts")
    })

    it("detects echo > file.ts", () => {
      const cmd = `echo "export const x = 1" > src/constants.ts`
      const files = detectShellFileWrites(cmd)
      expect(files).toContain("src/constants.ts")
    })

    it("detects tee file.ts", () => {
      const cmd = `echo "data" | tee src/output.ts`
      const files = detectShellFileWrites(cmd)
      expect(files).toContain("src/output.ts")
    })
  })

  describe("sed modifications", () => {
    it("detects sed -i on source files", () => {
      const cmd = `sed -i 's/foo/bar/g' src/config.ts`
      const files = detectShellFileWrites(cmd)
      expect(files).toContain("src/config.ts")
    })
  })

  describe("File creation (new files)", () => {
    it("detects touch creating new source file", () => {
      const cmd = `touch src/new-component.ts`
      const files = detectShellFileWrites(cmd)
      expect(files).toContain("src/new-component.ts")
    })

    it("detects touch with nested path", () => {
      const cmd = `touch packages/core/src/utils.ts`
      const files = detectShellFileWrites(cmd)
      expect(files).toContain("packages/core/src/utils.ts")
    })

    it("detects install creating source file", () => {
      const cmd = `install -m 644 template.ts src/component.ts`
      const files = detectShellFileWrites(cmd)
      expect(files).toContain("src/component.ts")
    })

    it("detects dd creating source file", () => {
      const cmd = `dd if=/dev/zero of=src/empty.ts bs=1 count=0`
      const files = detectShellFileWrites(cmd)
      expect(files).toContain("src/empty.ts")
    })

    it("detects truncate creating source file", () => {
      const cmd = `truncate -s 0 src/newfile.ts`
      const files = detectShellFileWrites(cmd)
      expect(files).toContain("src/newfile.ts")
    })

    it("detects generic redirect creating new source file", () => {
      const cmd = `printf 'export const x = 1' > src/constants.ts`
      const files = detectShellFileWrites(cmd)
      expect(files).toContain("src/constants.ts")
    })

    it("detects heredoc creating new source file", () => {
      const cmd = `cat > src/new-module.ts <<'EOF'
export default function hello() {
  return 'world'
}
EOF`
      const files = detectShellFileWrites(cmd)
      expect(files).toContain("src/new-module.ts")
    })

    it("detects python creating brand new file", () => {
      const cmd = `python3 -c "open('src/brand-new.ts','w').write('export const x = 1')"`
      const files = detectShellFileWrites(cmd)
      expect(files).toContain("src/brand-new.ts")
    })
  })

  describe("File operations (modify existing)", () => {
    it("detects mv to source file", () => {
      const cmd = `mv /tmp/new.ts src/old.ts`
      const files = detectShellFileWrites(cmd)
      expect(files).toContain("src/old.ts")
    })

    it("detects cp to source file", () => {
      const cmd = `cp template.ts src/component.ts`
      const files = detectShellFileWrites(cmd)
      expect(files).toContain("src/component.ts")
    })
  })

  describe("Read-only commands (should NOT be detected)", () => {
    it("does not flag ls", () => {
      const files = detectShellFileWrites("ls -la src/")
      expect(files).toHaveLength(0)
    })

    it("does not flag grep", () => {
      const files = detectShellFileWrites("grep -r 'import' src/")
      expect(files).toHaveLength(0)
    })

    it("does not flag cat without redirect", () => {
      const files = detectShellFileWrites("cat package.json")
      expect(files).toHaveLength(0)
    })

    it("does not flag find", () => {
      const files = detectShellFileWrites("find src -name '*.ts'")
      expect(files).toHaveLength(0)
    })

    it("does not flag pwd", () => {
      const files = detectShellFileWrites("pwd")
      expect(files).toHaveLength(0)
    })
  })

  describe("Excluded patterns", () => {
    it("does not flag node_modules writes", () => {
      const cmd = `python3 -c "open('node_modules/pkg/index.ts','w').write('')"`
      const files = detectShellFileWrites(cmd)
      expect(files).toHaveLength(0)
    })

    it("does not flag .sdd/ writes", () => {
      const cmd = `python3 -c "open('.sdd/config.ts','w').write('')"`
      const files = detectShellFileWrites(cmd)
      expect(files).toHaveLength(0)
    })

    it("does not flag dist/ writes", () => {
      const cmd = `python3 -c "open('dist/index.js','w').write('')"`
      const files = detectShellFileWrites(cmd)
      expect(files).toHaveLength(0)
    })

    it("does not flag package.json writes", () => {
      const cmd = `python3 -c "open('package.json','w').write('{}')"`
      const files = detectShellFileWrites(cmd)
      expect(files).toHaveLength(0)
    })

    it("does not flag tsconfig.json writes", () => {
      const cmd = `python3 -c "open('tsconfig.json','w').write('{}')"`
      const files = detectShellFileWrites(cmd)
      expect(files).toHaveLength(0)
    })
  })

  describe("Non-source files", () => {
    it("does not flag .md files", () => {
      const cmd = `python3 -c "open('README.md','w').write('# Hi')"`
      const files = detectShellFileWrites(cmd)
      expect(files).toHaveLength(0)
    })

    it("does not flag .json files", () => {
      const cmd = `python3 -c "open('config.json','w').write('{}')"`
      const files = detectShellFileWrites(cmd)
      expect(files).toHaveLength(0)
    })

    it("does not flag .yaml files", () => {
      const cmd = `python3 -c "open('data.yaml','w').write('key: value')"`
      const files = detectShellFileWrites(cmd)
      expect(files).toHaveLength(0)
    })
  })

  describe("Edge cases", () => {
    it("returns empty array for empty command", () => {
      expect(detectShellFileWrites("")).toEqual([])
    })

    it("returns empty array for whitespace-only command", () => {
      expect(detectShellFileWrites("   ")).toEqual([])
    })

    it("deduplicates file paths", () => {
      const cmd = `python3 -c "open('src/a.ts','w').write('1'); open('src/a.ts','a').write('2')"`
      const files = detectShellFileWrites(cmd)
      expect(files.filter(f => f === "src/a.ts")).toHaveLength(1)
    })

    it("handles complex heredoc with multiple patterns", () => {
      const cmd = `python3 - <<'EOF'
import re
src = open('packages/theme-sdk/src/fields.ts').read()
src = src.replace("old", "new")
open('packages/theme-sdk/src/fields.ts','w').write(src)
open('packages/theme-sdk/src/index.ts','w').write("export { x }")
EOF`
      const files = detectShellFileWrites(cmd)
      expect(files).toContain("packages/theme-sdk/src/fields.ts")
      expect(files).toContain("packages/theme-sdk/src/index.ts")
    })
  })
})
