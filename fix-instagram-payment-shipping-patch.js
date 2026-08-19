const fs = require('fs');
const { execFileSync } = require('child_process');

const file = './patch-instagram-payment-shipping-config.js';
let source = fs.readFileSync(file, 'utf8');

const oldLine = "    code = replaceOnce(code, oldPaymentChoice, newPaymentHelpers, 'payment helper');";
const robustBlock = `    const paymentHelperStart = code.indexOf('/* INSTAGRAM_PAYMENT_BRANCH_AND_PRODUCT_QA_V1 */');
    const paymentHelperEnd = code.indexOf('/* INSTAGRAM_CANCEL_PHONE_COVERAGE_V1 */', paymentHelperStart);
    if (paymentHelperStart < 0 || paymentHelperEnd < 0) throw new Error('payment helper markers not found');
    code = code.slice(0, paymentHelperStart) + newPaymentHelpers + '\\n' + code.slice(paymentHelperEnd);`;

if (source.includes(oldLine)) {
  source = source.replace(oldLine, robustBlock);
  fs.writeFileSync(file, source);
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  console.log('[INSTAGRAM_PAYMENT_SHIPPING_FIX] hardened payment helper markers');
} else if (source.includes('const paymentHelperStart = code.indexOf')) {
  console.log('[INSTAGRAM_PAYMENT_SHIPPING_FIX] already hardened');
} else {
  console.error('[INSTAGRAM_PAYMENT_SHIPPING_FIX] target line not found');
  process.exit(1);
}
