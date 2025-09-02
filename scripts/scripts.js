const clipCopy = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    alert("Copiado!");
  } catch (e) {
    alert("Erro ao copiar: " + e);
  }
};

const stripComments = (css) =>
  css.replace(/\/\*[\s\S]*?\*\//g, "");

function splitSelectorList(sel) {
  const parts = [];
  let buf = "", depth = 0;
  for (let i = 0; i < sel.length; i++) {
    const ch = sel[i];
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      parts.push(buf.trim());
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

function findMatchingBrace(str, idx) {
  let depth = 0, inStr = false, quote = "";
  for (let i = idx; i < str.length; i++) {
    const c = str[i];
    if (!inStr && c === "{") depth++;
    else if (!inStr && c === "}") {
      depth--;
      if (depth === 0) return i;
    } else if (c === '"' || c === "'") {
      if (!inStr) { inStr = true; quote = c; }
      else if (quote === c) inStr = false;
    }
  }
  return -1;
}

function parseBlocks(css) {
  const blocks = [];
  let i = 0;
  while (i < css.length) {
    if (/\s/.test(css[i])) { i++; continue; }
    if (css[i] === "@") {
      // at-rule
      const start = i;
      const brace = css.indexOf("{", i);
      if (brace === -1) break;
      const header = css.slice(i, brace).trim();
      const end = findMatchingBrace(css, brace);
      const body = css.slice(brace + 1, end);
      if (/^@media\b/i.test(header)) {
        blocks.push({ type: "media", header, children: parseBlocks(body) });
      } else {
        blocks.push({ type: "raw", text: header + "{" + body + "}" });
      }
      i = end + 1;
    } else {
      const brace = css.indexOf("{", i);
      if (brace === -1) break;
      const selector = css.slice(i, brace).trim();
      const end = findMatchingBrace(css, brace);
      const body = css.slice(brace + 1, end).trim();
      blocks.push({ type: "rule", selector, body });
      i = end + 1;
    }
  }
  return blocks;
}
const REG_FULL_VTEX =
  /\.vtex-[a-z0-9-]+-(?:[0-9]-)?x-[a-zA-Z0-9_-]+/g; 
const REG_FINAL_FROM_VTEX =
  /\.vtex-[a-z0-9-]+-(?:[0-9]-)?x-([a-zA-Z0-9_-]+)/g; 

function toGlobalSelector(sel) {
  return sel.replace(REG_FULL_VTEX, (m) => `:global(${m})`);
}

function toCleanSelector(sel) {
  return sel.replace(REG_FINAL_FROM_VTEX, (_, final) => `.${final}`);
}

function extractTrailingPseudo(sel) {
  const m = sel.match(/(?:(?:::?[a-zA-Z-]+(?:\([^\)]*\))?))+$/);
  if (!m) return { base: sel.trim(), pseudo: "" };
  const pseudo = m[0];
  const base = sel.slice(0, sel.length - pseudo.length).trim();
  return { base, pseudo };
}

function addToBucket(map, base, pseudo, decl) {
  if (!map.has(base)) map.set(base, { baseDecls: [], pseudoDecls: new Map() });
  const entry = map.get(base);
  if (pseudo) {
    if (!entry.pseudoDecls.has(pseudo)) entry.pseudoDecls.set(pseudo, []);
    entry.pseudoDecls.get(pseudo).push(decl);
  } else {
    entry.baseDecls.push(decl);
  }
}

function generateNestedSCSS(map) {
  let out = "";
  for (const [base, entry] of map.entries()) {
    out += `${base} {\n`;
    if (entry.baseDecls.length) {
      const merged = entry.baseDecls.join("\n").trim();
      if (merged) {
        merged.split("\n").forEach(line => {
          out += `  ${line.trim()}\n`;
        });
      }
    }
    for (const [pseudo, decls] of entry.pseudoDecls.entries()) {
      const merged = decls.join("\n").trim();
      if (!merged) continue;
      out += `  &${pseudo} {\n`;
      merged.split("\n").forEach(line => {
        out += `    ${line.trim()}\n`;
      });
      out += `  }\n`;
    }
    out += `}\n\n`;
  }
  return out.trim() + "\n";
}

function processBlocksToSCSS(blocks, selectorMapper) {
  const rootMap = new Map();
  const medias = []; 

  for (const b of blocks) {
    if (b.type === "rule") {
      const sels = splitSelectorList(b.selector);
      for (const s of sels) {
        // 🔑 primeiro separa pseudos, depois aplica o mapper só no base
        const { base, pseudo } = extractTrailingPseudo(s);
        const mappedBase = selectorMapper(base);
        addToBucket(rootMap, mappedBase, pseudo, b.body);
      }
    } else if (b.type === "media") {
      const inner = processBlocksToSCSS(b.children, selectorMapper);
      medias.push({ header: b.header, scss: inner });
    }
  }

  let out = generateNestedSCSS(rootMap);
  for (const m of medias) {
    if (m.scss.trim()) {
      out += `${m.header} {\n`;
      m.scss.trim().split("\n").forEach(line => {
        out += `  ${line}\n`;
      });
      out += `}\n\n`;
    }
  }
  return out.trim() + "\n";
}


function processFlat(css, selectorMapper, keepPseudosAndMedia) {
  let out = css.replace(REG_FULL_VTEX, (m) => selectorMapper(m));
  if (!keepPseudosAndMedia) {
    out = out
      .replace(/:(hover|focus|active|visited|disabled|link|checked|focus-within|focus-visible|before|after|placeholder|first-child|last-child|nth-child\([^\)]*\))(?=[^{,]*)/g, "")
      .replace(/::(before|after|marker|placeholder|selection|backdrop|file-selector-button|part\([^\)]*\)|slotted\([^\)]*\))/g, "")
      .replace(/::-webkit-[a-z-]+/g, "")
      .replace(/@media[^{]+\{(?:[^{}]|\{[^{}]*\})*\}/g, ""); 
  } else {
    out = out.replace(/([^{}]+)\{/g, (m, sel) => selectorMapper(sel) + "{");
  }
  return out;
}
async function convertCSS() {
  const inputCSS = document.getElementById("cssInput").value || "";
  const useScss = document.getElementById("useScss").checked;

  const css = stripComments(inputCSS);

  if (useScss) {

    const blocks = parseBlocks(css);
    const cleanSCSS = processBlocksToSCSS(blocks, toCleanSelector);
    const globalSCSS = processBlocksToSCSS(blocks, toGlobalSelector);

    document.getElementById("cleanOutput").value = cleanSCSS;
    document.getElementById("globalOutput").value = globalSCSS;
  } else {

    const cleanFlat = processFlat(css, (s) => toCleanSelector(s), false);
    const globalFlat = processFlat(css, (s) => toGlobalSelector(s), false);
    document.getElementById("cleanOutput").value = cleanFlat;
    document.getElementById("globalOutput").value = globalFlat;
  }
}

window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("convertBtn").addEventListener("click", convertCSS);
  document.querySelectorAll("button[data-copy]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-copy");
      const ta = document.getElementById(id);
      clipCopy(ta.value);
    });
  });
});
