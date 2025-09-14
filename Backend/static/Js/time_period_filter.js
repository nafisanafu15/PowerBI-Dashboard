// Build a time period selector with preset options and custom range
function initTimePeriodFilter(rootSelector, onChange){
  const root = typeof rootSelector === 'string' ? document.querySelector(rootSelector) : rootSelector;
  if(!root) return;
  const radios = root.querySelectorAll('input[name="time"]');
  const rangeDiv = root.querySelector('.date-range');
  const input = root.querySelector('input[type="text"]');
  const applyBtn = root.querySelector('.apply-range');
  const cancelBtn = root.querySelector('.cancel-range');
  let from = null, to = null;

  const fp = flatpickr(input, {mode:'range', onClose: sel => {from=sel[0]; to=sel[1];}});

  function preset(value){
    // Set date range based on quick preset buttons
    const now = new Date();
    let start=null,end=null;
    if(value==='today'){start=end=now;}
    else if(value==='week'){start=new Date(now);start.setDate(now.getDate()-now.getDay());end=new Date(start);end.setDate(start.getDate()+6);}
    else if(value==='month'){start=new Date(now.getFullYear(),now.getMonth(),1);end=new Date(now.getFullYear(),now.getMonth()+1,0);}
    else if(value==='year'){start=new Date(now.getFullYear(),0,1);end=new Date(now.getFullYear(),11,31);}
    if(start&&end){ fp.setDate([start,end], true); from=start; to=end; }
  }

  radios.forEach(r => {
    r.addEventListener('change', () => {
      if(r.value==='custom'){
        rangeDiv.style.display='flex';
        fp.open();
      }else{
        rangeDiv.style.display='none';
        preset(r.value);
        if(typeof onChange==='function') onChange(from,to);
      }
    });
  });

  applyBtn&&applyBtn.addEventListener('click',()=>{ if(typeof onChange==='function') onChange(from,to); });
  cancelBtn&&cancelBtn.addEventListener('click',()=>{
    fp.clear();
    from=null;to=null;
    rangeDiv.style.display='none';
    radios.forEach(r=>{ if(r.value==='custom') r.checked=false; });
    if(typeof onChange==='function') onChange(from,to);
  });
}
// Expose initializer globally
window.initTimePeriodFilter = initTimePeriodFilter;
