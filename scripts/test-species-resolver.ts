/**
 * Smoke test for the species resolver. Asserts that real `treeType` strings
 * from the Taipei dataset map to the expected config id. Catches matchPattern
 * typos and resolver regressions.
 */
import { resolveSpecies } from '../server/src/species/resolver';

type Case = { treeType: string; expectedId: string };

const CASES: Case[] = [
  // spreading-broadleaf
  { treeType: '榕樹', expectedId: 'spreading-broadleaf' },
  { treeType: '茄苳', expectedId: 'spreading-broadleaf' },
  { treeType: '樟樹', expectedId: 'spreading-broadleaf' },
  { treeType: 'Ficus microcarpa', expectedId: 'spreading-broadleaf' },
  { treeType: 'Cinnamomum camphora', expectedId: 'spreading-broadleaf' },

  // columnar-narrow
  { treeType: '白千層', expectedId: 'columnar-narrow' },
  { treeType: '木棉', expectedId: 'columnar-narrow' },
  { treeType: 'Melaleuca leucadendra', expectedId: 'columnar-narrow' },

  // pagoda-layered
  { treeType: '小葉欖仁', expectedId: 'pagoda-layered' },
  { treeType: '黑板樹', expectedId: 'pagoda-layered' },
  { treeType: 'Terminalia mantaly', expectedId: 'pagoda-layered' },
  { treeType: 'Alstonia scholaris', expectedId: 'pagoda-layered' },

  // pyramidal-conical
  { treeType: '楓香', expectedId: 'pyramidal-conical' },
  { treeType: 'Liquidambar formosana', expectedId: 'pyramidal-conical' },

  // vase-spreading
  { treeType: '大花紫薇', expectedId: 'vase-spreading' },
  { treeType: '紫薇', expectedId: 'vase-spreading' },
  { treeType: '臺灣欒樹', expectedId: 'vase-spreading' },
  { treeType: '台灣欒樹', expectedId: 'vase-spreading' },
  { treeType: 'Lagerstroemia speciosa', expectedId: 'vase-spreading' },
  { treeType: 'Koelreuteria henryi', expectedId: 'vase-spreading' },

  // palm-monopodial
  { treeType: '大王椰子', expectedId: 'palm-monopodial' },
  { treeType: '蒲葵', expectedId: 'palm-monopodial' },
  { treeType: 'Roystonea regia', expectedId: 'palm-monopodial' },

  // unmatched → default
  { treeType: '阿勃勒', expectedId: 'default' },
  { treeType: '苦楝', expectedId: 'default' },
  { treeType: '', expectedId: 'default' },
  { treeType: 'unknown species', expectedId: 'default' },
];

let failed = 0;
for (const c of CASES) {
  const got = resolveSpecies(c.treeType).id;
  if (got === c.expectedId) {
    console.log(`OK   "${c.treeType}" → ${got}`);
  } else {
    console.error(`FAIL "${c.treeType}" → ${got} (expected ${c.expectedId})`);
    failed++;
  }
}

if (failed > 0) {
  console.error(`\n${failed}/${CASES.length} cases failed`);
  process.exit(1);
}
console.log(`\nall ${CASES.length} cases pass`);
