import fs from 'fs';
import path from 'path';
import ts from 'typescript';

// Same static-import reachability method as the cold-start report: resolve
// repository imports from index.ts, excluding type-only and dynamic imports.
// Read source instead of executing App and mocking every native dependency.
function eagerStartupModules() {
  const root = path.resolve(__dirname, '../..');
  const files = new Set<string>();
  const external = new Set<string>();
  const queue = ['index.ts'];
  const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js'];
  while (queue.length) {
    const file = queue.shift()!;
    if (files.has(file)) continue;
    files.add(file);
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(path.join(root, file), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    for (const statement of source.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        statement.importClause?.isTypeOnly
      ) {
        continue;
      }
      const clause = statement.importClause;
      if (
        clause &&
        !clause.name &&
        clause.namedBindings &&
        ts.isNamedImports(clause.namedBindings) &&
        clause.namedBindings.elements.every((element) => element.isTypeOnly)
      ) {
        continue;
      }
      const name = statement.moduleSpecifier.text;
      if (!name.startsWith('.')) {
        external.add(name);
        continue;
      }
      const base = path.resolve(root, path.dirname(file), name);
      const resolved = extensions
        .map((extension) => base + extension)
        .find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
      if (resolved && !resolved.endsWith('.json')) queue.push(path.relative(root, resolved));
    }
  }
  return { files, external };
}

it('keeps both startup wizard hosts eager while deferring the Add Wallet graph', () => {
  const { files } = eagerStartupModules();
  expect(files.has('src/components/HomeSheets.tsx')).toBe(true);
  expect(files.has('src/components/LnurlWithdrawSheet.tsx')).toBe(true);
  expect(files.has('src/components/LazyAddWalletWizard.tsx')).toBe(true);
  for (const module of [
    'src/components/AddWalletWizard.tsx',
    'src/components/CreateCoinosWalletSheet.tsx',
    'src/components/CoinosRecoverySheet.tsx',
    'src/styles/AddWalletWizard.styles.ts',
    'src/utils/useAddWalletWizardKeyboard.ts',
  ]) {
    expect(files.has(module)).toBe(false);
  }
});
