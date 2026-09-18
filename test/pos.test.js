// 北流市集 POS —— 純邏輯測試（無外部相依，node test/pos.test.js）
// 從 index.html 抽出 id="pos-core" 的 script，在 vm 裡跑，測試純函式。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const m = html.match(/<script id="pos-core">([\s\S]*?)<\/script>/);
if (!m) { console.error('找不到 pos-core script'); process.exit(1); }
const sandbox = {};
sandbox.globalThis = sandbox;
vm.runInNewContext(m[1], sandbox);
const P = sandbox.POS;
if (!P) { console.error('POS 未定義（core 語法可能有誤）'); process.exit(1); }

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.error('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
function eq(name, got, want) { ok(name, got === want, 'got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }

// 1. 數字強制轉型（你反覆踩的字串相加雷）
eq('num 字串→數字', P.num('250'), 250);
eq('num 帶逗號', P.num('1,200'), 1200);
eq('num 空字串→0', P.num(''), 0);
ok('num 回傳是 number 不是字串', typeof P.num('250') === 'number');

// 2. 成本：空＝未知(null)，不可當 0
eq('costOf 空→null', P.costOf(''), null);
eq('costOf null→null', P.costOf(null), null);
eq('costOf 有值', P.costOf('120'), 120);

// 3. parseDataJson：只帶在售/保留中(已售出、已下架不匯入)；字串價格轉數字、空成本 null、保留中不勾選
(function () {
  const data = { listings: [
    { id: 'x1', artist: 'Nirvana', album: 'In Utero', price: '350', cost: '120', status: '在售' },
    { id: 'x2', artist: 'Jeff Beck', album: 'Who Else!', price: '150', cost: '', status: '保留中', notes: '日盤' },
    { id: 'x3', artist: 'Old', album: 'Sold', price: '99', cost: '30', status: '已售出' },
    { id: 'x4', artist: 'Gone', album: 'Delisted', price: '80', cost: '20', status: '已下架' }
  ]};
  const items = P.parseDataJson(data);
  eq('parse 只匯入在售+保留中(2筆)', items.length, 2);
  ok('parse 不匯入已售出', !items.some(i => i.album === 'Sold'));
  ok('parse 不匯入已下架', !items.some(i => i.album === 'Delisted'));
  eq('parse 價格轉數字', items[0].price, 350);
  ok('parse 價格型別 number', typeof items[0].price === 'number');
  eq('parse 空成本→null', items[1].cost, null);
  eq('parse notes→version', items[1].version, '日盤');
  eq('parse 在售預設勾選', items[0].include, true);
  eq('parse 保留中不勾選(不拿去賣)', items[1].include, false);
})();

// 4. assignCodes 非force = 只補未編號(從最大號+1續編、不覆蓋)；force = 全部重編
(function () {
  const items = [
    { artist: 'A', include: true },
    { artist: 'B', include: false },
    { artist: 'C', include: true, code: 'KEEP9' },
    { artist: 'D', include: true }
  ];
  const out = P.assignCodes(items, 'R');          // 非 force：只補缺號
  eq('補號 未編號給R001', out[0].code, 'R001');
  eq('補號 未勾選略過', out[1].code, undefined);
  eq('補號 保留既有不覆蓋', out[2].code, 'KEEP9');
  eq('補號 第二個未編號給R002', out[3].code, 'R002');
  const forced = P.assignCodes(items, 'R', true);  // force：全部重編
  eq('force 重編第一筆', forced[0].code, 'R001');
  eq('force 覆蓋既有 code', forced[2].code, 'R002');
  eq('force 未勾選仍略過', forced[1].code, undefined);
})();

// 4b. 補號要從「目前最大號」續編，不能從 001 撞號（使用者核心需求）
(function () {
  const items = [
    { code: 'A005', include: true },   // 已編號
    { include: true },                 // 新加，未編號
    { include: true }                  // 新加，未編號
  ];
  const out = P.assignCodes(items, 'A');
  eq('補號 保留 A005', out[0].code, 'A005');
  eq('補號 從 A006 續', out[1].code, 'A006');
  eq('補號 再 A007', out[2].code, 'A007');
  eq('maxCodeNum 取最大', P.maxCodeNum([{code:'A001'},{code:'A007'},{code:'B999'},{code:''}], 'A'), 7);
})();

// 4d. parseBulk：批量貼上（Tab/逗號、標題略過、空成本 null、數字轉型、版本）
(function () {
  const tsv = '藝人\t專輯\t售價\t成本\t版本\n'
            + 'Nirvana\tIn Utero\t350\t120\t日盤\n'
            + 'Radiohead\tOK Computer\t400\n'   // 無成本、無版本
            + '\n'                               // 空列
            + 'Sade\tLove Deluxe\t250\t\t英版';  // 成本欄留空但有版本
  const rows = P.parseBulk(tsv);
  eq('parseBulk 略過標題+空列，得 3 筆', rows.length, 3);
  eq('第一筆藝人', rows[0].artist, 'Nirvana');
  eq('售價轉數字', rows[0].price, 350);
  ok('售價型別 number', typeof rows[0].price === 'number');
  eq('成本 120', rows[0].cost, 120);
  eq('版本 日盤', rows[0].version, '日盤');
  eq('無成本欄→null', rows[1].cost, null);
  eq('成本欄留空→null(非0)', rows[2].cost, null);
  eq('留空成本仍讀到版本', rows[2].version, '英版');
  // 逗號格式
  const csv = 'Oasis,Definitely Maybe,300';
  const r2 = P.parseBulk(csv);
  eq('逗號格式 1 筆', r2.length, 1);
  eq('逗號格式售價', r2[0].price, 300);
  eq('批量預設勾選', r2[0].include, true);
})();

// 4c. mergeImport：再匯入只加新的(srcId 沒見過)，既有編號/編輯完全保留
(function () {
  const existing = [{ srcId: 'x1', code: 'A001', artist: '已編輯' }, { srcId: '', artist: '手動品' }];
  const incoming = [{ srcId: 'x1', artist: '原始' }, { srcId: 'x2', artist: '新貨' }];
  const r = P.mergeImport(existing, incoming);
  eq('merge 只加新的1筆', r.added, 1);
  eq('merge 略過已存在1筆', r.skipped, 1);
  eq('merge 總數 2+1', r.items.length, 3);
  eq('merge 既有編號不被覆蓋', r.items[0].code, 'A001');
  eq('merge 既有編輯保留', r.items[0].artist, '已編輯');
  eq('merge 新貨加入', r.items[2].artist, '新貨');
})();

// 5. calcCart：字串價格必須加總為數字，不能字串串接
(function () {
  const lines = [{ price: '250' }, { price: '200' }, { price: '100' }];
  eq('calcCart 加總', P.calcCart(lines), 550);   // 若字串串接會得到 '250200100'
})();

// 6. applyDiscount amount + 夾制（折抵超過小計→total 0，不為負）
(function () {
  const lines = [{ price: 100 }];
  eq('折抵金額', P.applyDiscount(100, lines, { type: 'amount', value: 30 }).total, 70);
  const over = P.applyDiscount(100, lines, { type: 'amount', value: 999 });
  eq('折抵超額 total 夾到 0', over.total, 0);
  eq('折抵超額 amount 夾到小計', over.amount, 100);
})();

// 7. percent：打9折 = 付 90%
eq('打9折', P.applyDiscount(1000, [], { type: 'percent', value: 9 }).total, 900);

// 8. setTotal：直接指定總額；且不得反向加價（填比小計高→夾住，絕不多收客人錢）
eq('直接改總額', P.applyDiscount(770, [], { type: 'setTotal', value: 700 }).total, 700);
(function () {
  const r = P.applyDiscount(100, [{ price: 100 }], { type: 'setTotal', value: 200 });
  eq('setTotal 超過小計不加價(total)', r.total, 100);
  eq('setTotal 超過小計不加價(amount)', r.amount, 0);
})();

// 9. bundle 任選3張500
(function () {
  const c3 = [{ price: 300 }, { price: 250 }, { price: 200 }]; // sum 750
  eq('bundle 3張折扣', P.bundleDiscount(c3, 3, 500), 250);
  eq('bundle 3張套用後總額', P.applyDiscount(750, c3, { type: 'bundle', n: 3, y: 500 }).total, 500);
  const c2 = [{ price: 300 }, { price: 250 }];
  eq('bundle 不足N張不折', P.bundleDiscount(c2, 3, 500), 0);
  const c7 = [400, 350, 300, 250, 200, 150, 100].map(p => ({ price: p })); // sum 1750
  // 2 組(取貴的6張 400+350+300+250+200+150=1650)→付 2*500=1000，折 650；最便宜的100張照單價
  eq('bundle 7張2組', P.bundleDiscount(c7, 3, 500), 650);
})();

// 9b. soldCodes：已成立訂單的編號集合(空號不計，否則會誤藏所有未編號商品)
(function () {
  const orders = [
    { lines: [{ code: 'A001', price: 100 }, { code: 'A002', price: 200 }] },
    { lines: [{ code: 'A005', price: 50 }, { code: '', price: 50, quick: true }] }  // 銅板箱快速品項無編號
  ];
  const sold = P.soldCodes(orders);
  ok('A001 已售', sold['A001'] === true);
  ok('A002 已售', sold['A002'] === true);
  ok('A005 已售', sold['A005'] === true);
  ok('未售的 A003 不在集合', !sold['A003']);
  ok('空號不進集合(不會誤藏未編號商品)', !sold['']);
  // 模擬收銀排除：catalog 過濾掉 sold 的編號
  const catalog = [{ code: 'A001' }, { code: 'A003' }, { code: '' }];
  const visible = catalog.filter(it => !(it.code && sold[it.code]));
  eq('收銀可見: A001已售被排除、A003與未編號留下', visible.map(i => i.code).join(','), 'A003,');
})();

// 9c. 老闆 PIN：寫死 0408，正確放行、其餘一律擋（純唬人用）
(function () {
  ok('正確 0408 放行', P.checkOwnerPin('0408') === true);
  ok('錯誤 PIN 擋下', P.checkOwnerPin('1234') === false);
  ok('空字串擋下', P.checkOwnerPin('') === false);
  ok('null 擋下', P.checkOwnerPin(null) === false);
  ok('相近但不同擋下', P.checkOwnerPin('04080') === false);
})();

// 10. 幫手包：絕對不含成本（key 與值都不能外洩）。用不撞價格的獨特成本值，且掃描排除 ts 時間戳
(function () {
  const items = [
    { code: 'A001', artist: 'Nirvana', album: 'In Utero', version: '', price: 350, cost: 7777, include: true },
    { code: 'A002', artist: 'Radiohead', album: 'OK Computer', version: '英版', price: 400, cost: 8888, include: true },
    { code: '', artist: 'NoCode', album: 'x', price: 50, cost: 6666, include: true }, // 無編號不進包
    { code: 'A003', artist: 'Skip', album: 'y', price: 10, cost: 5555, include: false } // 未勾選不進包
  ];
  const pkg = P.buildHelperPackage(items, [{ label: '折100', type: 'amount', value: 100 }], [{ label: '銅板', price: 50, cost: 9999 }]);
  ok('幫手包 items 無 cost 屬性', pkg.items.every(it => !('cost' in it)));
  ok('幫手包 quick 無 cost 屬性', (pkg.quick || []).every(q => !('cost' in q)));
  const scan = JSON.stringify(pkg.items) + JSON.stringify(pkg.quick) + JSON.stringify(pkg.presets);
  ok('無任何成本值外洩', ['7777', '8888', '6666', '5555', '9999'].every(v => scan.indexOf(v) === -1), scan);
  eq('幫手包只收已編號+勾選', pkg.items.length, 2);
  ok('幫手包保留售價', pkg.items[0].price === 350);
})();

// 11. computeAccounting：依編號回查成本、成本未知不計入但回報
(function () {
  const byCode = {
    A001: { cost: 120 }, A002: { cost: 200 }, A003: { cost: null } // A003 成本未知
  };
  const orders = [
    { total: 350, day: '9/19', lines: [{ code: 'A001', price: 350 }] },
    { total: 600, day: '9/19', lines: [{ code: 'A002', price: 400 }, { code: 'A003', price: 200 }] }
  ];
  const a = P.computeAccounting(orders, byCode);
  eq('營收', a.revenue, 950);
  eq('已知成本(120+200,未知略過)', a.knownCost, 320);
  eq('毛利', a.profit, 630);
  eq('成本未知件數', a.unknownCostCount, 1);
  eq('售出張數', a.itemsSold, 3);
  eq('分日9/19營收', a.byDay['9/19'].revenue, 950);
})();

// 12. 編號區分同專輯不同版本（同 artist+album、不同 code/price 都保留）
(function () {
  const items = [
    { code: 'B001', artist: 'Pink Floyd', album: 'The Wall', version: '日版', price: 500, cost: 200, include: true },
    { code: 'B002', artist: 'Pink Floyd', album: 'The Wall', version: '歐版', price: 350, cost: 150, include: true }
  ];
  const pkg = P.buildHelperPackage(items, [], []);
  eq('同專輯兩版本都在', pkg.items.length, 2);
  ok('兩版本售價不同', pkg.items[0].price !== pkg.items[1].price);
  ok('兩版本編號不同', pkg.items[0].code !== pkg.items[1].code);
})();

console.log('\n北流POS 測試：' + pass + ' 通過, ' + fail + ' 失敗');
process.exit(fail ? 1 : 0);
