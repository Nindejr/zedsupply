const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync('js/products.js', 'utf8'), sandbox);
const P = sandbox.window.ZSProduct;
const ctx = { departments: [{ id: 'tech' }], brands: [] };
function product() {
  const p = { title:'Test phone', category:'tech', seller:'test', priceZMW:1500, stock:'in',
    attributes:{condition:'used',conditionNotes:'Minor marks on the case.',features:['USB-C charging','Choose storage and pack size']},
    options:{colour:[{name:'Blue',hex:'#0057AE'}],size:['M'],extra:[
      {key:'custom_storage',name:'Storage',values:['128 GB','256 GB']},
      {key:'custom_pack',name:'Pack size',values:['Phone only','Starter kit']}]}};
  p.variants = P.matrix(p.options, []).map((v,i)=>({...v,stock:2,sku:P.skuFor('TEST',v),priceZMW:1500+i*100}));
  return p;
}
test('four-axis matrix round-trips through validation, storage, selections and cart descriptions',()=>{
  const p = product(); assert.equal(p.variants.length,4); assert.equal(P.validate(p,ctx).length,0);
  const clean=P.clean(p), selected=P.defaultSelection(clean), found=P.findVariant(clean,selected);
  assert.equal(found.custom_storage,'128 GB'); assert.equal(found.custom_pack,'Phone only');
  assert.match(P.describe(clean,selected),/Storage: 128 GB/); assert.match(P.describe(clean,selected),/Pack size: Phone only/);
  assert.equal(new Set(clean.variants.map(v=>v.sku)).size,4);
  assert.equal(clean.attributes.conditionNotes,'Minor marks on the case.');
  assert.equal(clean.attributes.features.length,2);
});
test('stock availability checks all other selected axes',()=>{
  const p=product();p.variants.find(v=>v.custom_storage==='256 GB'&&v.custom_pack==='Starter kit').stock=0;
  assert.equal(P.valueInStock(p,'custom_storage','256 GB',{colour:'Blue',size:'M',custom_pack:'Starter kit'}),false);
  assert.equal(P.valueInStock(p,'custom_storage','256 GB',{colour:'Blue',size:'M',custom_pack:'Phone only'}),true);
});
test('units normalize spelling and equivalent measures without mixing dimensions',()=>{
  assert.equal(P.parseSize('2 litres').unit,'l');assert.equal(P.parseSize('.5 kilograms').value,.5);
  assert.equal(P.sizeToken('1 litre'),P.sizeToken({value:1000,unit:'ml'}));
  assert.equal(P.measureMatches({attributes:{size:{value:1000,unit:'ml'}}},'volume',1000,1000),true);
  assert.equal(P.measureMatches({attributes:{size:{value:1,unit:'kg'}}},'volume',1000,1000),false);
});
test('combined filters match one actual variant, not separate colour and size matches',()=>{
  const p={options:{colour:[{name:'Red'},{name:'Blue'}],size:['S','M']},variants:[
    {sku:'A',colour:'Red',size:'S',stock:2},{sku:'B',colour:'Blue',size:'M',stock:2}]};
  assert.equal(P.matchingVariants(p,{colour:'Red',size:P.sizeToken('M')}).length,0);
  assert.equal(P.matchingVariants(p,{colour:'Blue',size:P.sizeToken('M')}).length,1);
});
test('condition notes, feature limits, distinct choices and combination caps are enforced',()=>{
  let p=product();delete p.attributes.conditionNotes;assert(P.validate(p,ctx).some(e=>e.field==='condition'));
  p=product();p.attributes.features=Array(9).fill('Fact');assert(P.validate(p,ctx).some(e=>e.field==='features'));
  p=product();p.options.extra[0].values=['128 GB','128 GB'];assert(P.validate(p,ctx).some(e=>e.field==='variants'));
  p=product();p.options.extra[0].values=Array.from({length:30},(_,i)=>'Storage '+i);p.options.extra[1].values=Array.from({length:30},(_,i)=>'Pack '+i);
  assert.equal(P.matrix(p.options,[]).length,0);assert(P.validate(p,ctx).some(e=>e.message.includes('256')));
});
test('malformed lists are rejected safely and ratings accept only whole stars',()=>{
  let p=product();p.options.extra='invalid';assert(P.validate(p,ctx).length>0);
  assert.equal(P.ratingSummary([{rating:5},{rating:4.5},{rating:0},{rating:6}]).count,1);
});
