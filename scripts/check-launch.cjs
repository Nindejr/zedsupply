const fs = require('node:fs');
const vm = require('node:vm');
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync('js/catalogue.js', 'utf8'), sandbox);
const s = sandbox.window.ZS_CATALOGUE.settings, b = s.business || {}, blockers = [];
if (!s.api.enabled) blockers.push('Live API activation is disabled.');
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(s.api.url || '') || !s.api.key) blockers.push('Supply the project URL and publishable key.');
for (const key of ['legalName', 'streetAddress', 'supportHours']) if (!b[key] || /\[/.test(b[key])) blockers.push('Confirm business.' + key + '.');
if (!b.deliveryApproved) blockers.push('Approve actual delivery coverage, prices and commitments.');
if (!b.returnsApproved) blockers.push('Approve returns and refund policies.');
if (!s.vat.verified || s.vat.registered && !/^\d{10}$/.test(s.vat.tpin || '')) blockers.push('Verify the business VAT status; a configured tax rate does not verify registration.');
if (!s.payments.contractValidated) blockers.push('Complete payment-provider sandbox acceptance and reconciliation; leave prompts disabled meanwhile.');
if (s.allowDemo) blockers.push('Set allowDemo:false before accepting real seller listings.');
if (blockers.length) { console.log('LIVE ACTIVATION BLOCKED\n' + blockers.map(b => '- ' + b).join('\n')); process.exitCode = 1; }
else console.log('Local launch configuration is complete. Confirm hosted configuration and staging acceptance separately.');
