(() => {
'use strict';
const API_BASE='https://api.brickasso.ro/shop/';
const f=document.getElementById('orderForm');
const feedback=document.getElementById('feedback');
const quoteBtn=document.getElementById('quoteBtn');
const payArea=document.getElementById('payArea');
const paypalArea=document.getElementById('paypalArea');
const paypalBtn=document.getElementById('paypalBtn');
const cardArea=document.getElementById('cardArea');
const cardBtn=document.getElementById('cardBtn');
let latestPayload=null, latestSignature=null, configuration=null;
let paypalSession=null, guestSession=null, initialized=false;
let activeOrderId=null, paymentApproved=false, starting=false, completedRef=null;
const format=v=>'€'+Number(v).toFixed(2);
const message=v=>{feedback.textContent=v;};
const payload=()=>Object.fromEntries(new FormData(f).entries());
const sig=v=>JSON.stringify(v);
const countries={RO:'Romania',AT:'Austria',BE:'Belgium',DK:'Denmark',EE:'Estonia',FI:'Finland',FR:'France',DE:'Germany',IT:'Italy',LV:'Latvia',LT:'Lithuania',LU:'Luxembourg',NL:'Netherlands',PT:'Portugal',ES:'Spain',SE:'Sweden'};
// Populate the delivery countries independently of PayPal or API availability.
const countrySelect=f.elements.namedItem('country');
function renderCountries(allowed){
 const selected=countrySelect.value;
 const supported=Array.isArray(allowed)&&allowed.length?allowed:Object.keys(countries);
 countrySelect.replaceChildren(new Option('Select country',''));
 for(const code of supported){
  if(!Object.prototype.hasOwnProperty.call(countries,code))continue;
  countrySelect.add(new Option(countries[code],code));
 }
 if(supported.includes(selected))countrySelect.value=selected;
}
renderCountries(Object.keys(countries));
async function api(path,data){
  const response=await fetch(API_BASE+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),cache:'no-store'});
  const json=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(json.error||'Service unavailable');
  return json;
}
function invalidate(){
 latestPayload=null;latestSignature=null;payArea.hidden=true;
 document.getElementById('shipping').textContent='Not calculated';
 document.getElementById('total').textContent='—';
 document.getElementById('subtotal').textContent=format(30*(Number(f.quantity.value)||1));
 message('');
}
f.addEventListener('input',invalidate);
f.addEventListener('change',invalidate);
function reservationCancel(){
 if(paymentApproved||!activeOrderId)return;
 const id=activeOrderId;activeOrderId=null;
 api('cancel-order.php',{orderId:id})
   .then(r=>message(r.cancelled?'Payment cancelled. Stock reservation released.':'Payment cancelled. Reservation will be reviewed automatically.'))
   .catch(()=>message('Payment cancelled. Reservation expires automatically.'));
}
async function captureApproved({orderId}){
 paymentApproved=true;activeOrderId=null;
 message('Confirming payment...');
 try{
  const data=await api('capture-order.php',{orderId});
  if(data.status==='COMPLETED' && data.order_ref){completedRef=data.order_ref;return;}
  throw new Error('Payment is pending confirmation. Contact orders@brickasso.ro before trying again.');
 } catch(e){message(e.message);throw e;}
}
function completed(){
 if(completedRef)location.href='order-confirmation.html?ref='+encodeURIComponent(completedRef);
 else message('Payment confirmation pending. Please contact orders@brickasso.ro before retrying.');
}
async function createOrder(){
 if(starting)throw new Error('A payment is already being started.');
 if(!f.reportValidity()||!latestPayload||sig(payload())!==latestSignature)throw new Error('Recalculate shipping before payment.');
 starting=true;
 paymentApproved=false;activeOrderId=null;completedRef=null;
 try{
  const result=await api('create-order.php',latestPayload);
  activeOrderId=result.orderId;
  return {orderId:result.orderId};
 }finally{starting=false;}
}
async function setup(){
 try{
  const sdk=await window.paypal.createInstance({
   clientId:configuration.clientId,
   components:['paypal-payments','paypal-guest-payments'],
   pageType:'checkout'
  });
  const eligibility=await sdk.findEligibleMethods({currencyCode:'EUR'});
  if(eligibility.isEligible('paypal')){
   paypalSession=sdk.createPayPalOneTimePaymentSession({
    onApprove:async d=>{await captureApproved(d);completed();},
    onCancel:()=>{if(!paymentApproved){message('Payment cancelled.');reservationCancel();}},
    onError:()=>message('PayPal reported an error. Check your account before retrying.')
   });
   paypalArea.hidden=false;
   paypalBtn.hidden=false;
  }
  if(eligibility.isEligible('card') && typeof sdk.createPayPalGuestOneTimePaymentSession==='function'){
   guestSession=await sdk.createPayPalGuestOneTimePaymentSession({
    onApprove:captureApproved,
    onComplete:completed,
    onCancel:()=>{if(!paymentApproved){message('Card payment cancelled.');reservationCancel();}},
    onError:()=>message('Card payment could not be completed. Check the payment status before retrying.'),
    onWarn:d=>message(d.message||'Please check your card details and try again.')
   });
   cardArea.hidden=false;
  }
  initialized=Boolean(paypalSession||guestSession);
  if(!initialized)message('Payment methods are not available for this merchant or region.');
 }catch(e){message('Payment methods could not be initialized.');}
}
async function load(){
 try{
  const response=await fetch(API_BASE+'public-config.php',{cache:'no-store'});
  if(!response.ok)throw new Error('Public configuration unavailable.');
  configuration=await response.json();
  if(Array.isArray(configuration.countries) && configuration.countries.length){renderCountries(configuration.countries);}
  if(configuration.mode==='sandbox')document.getElementById('sandbox').hidden=false;
  if(!configuration.enabled){message('Payments are not active yet. You can still calculate shipping.');return;}
  const script=document.createElement('script');
  script.src=configuration.mode==='sandbox'?'https://www.sandbox.paypal.com/web-sdk/v6/core':'https://www.paypal.com/web-sdk/v6/core';
  script.onload=setup;
  script.onerror=()=>message('Could not load PayPal.');
  document.head.appendChild(script);
 }catch(e){message('Payment service is temporarily unavailable. Shipping countries remain selectable.');}
}
quoteBtn.addEventListener('click',async()=>{
 if(!f.reportValidity())return;
 try{
  quoteBtn.disabled=true;message('Calculating shipping...');
  const p=payload();const q=await api('quote.php',p);
  latestPayload=p;latestSignature=sig(p);
  document.getElementById('subtotal').textContent=format(q.subtotal);
  document.getElementById('shipping').textContent=format(q.shipping);
  document.getElementById('total').textContent=format(q.total);
  payArea.hidden=!initialized;
  message(configuration?.enabled && initialized?'Choose card or PayPal to complete your order.':'Shipping calculated. Payments are currently unavailable.');
 }catch(e){invalidate();message(e.message);}finally{quoteBtn.disabled=false;}
});
paypalBtn.addEventListener('click',async()=>{
 if(!paypalSession)return;
 try{
  const order=await createOrder();
  await paypalSession.start({presentationMode:'auto'},Promise.resolve(order));
 }catch(e){message(e.message);}
});
cardBtn.addEventListener('click',async()=>{
 if(!guestSession)return;
 try{
  const order=await createOrder();
  await guestSession.start({presentationMode:'auto',targetElement:cardBtn},Promise.resolve(order));
 }catch(e){message(e.message);}
});
const params=new URLSearchParams(location.search);
const map={'black-white':'BC-CAP-001','black-black':'BC-CAP-002','white-black':'BC-CAP-003','white-white':'BC-CAP-004'};
if(map[params.get('variant')])f.sku.value=map[params.get('variant')];
const quantity=Number(params.get('quantity'));
if(Number.isInteger(quantity)&&quantity>=1&&quantity<=10)f.quantity.value=String(quantity);
load();
})();
