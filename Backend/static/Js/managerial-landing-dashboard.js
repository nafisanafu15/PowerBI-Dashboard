// Js/managerial-landing-dashboard.js

// 1) Wait until DOM is ready
function parseDate(d){
  if(!d) return null;
  const p=d.split('/');
  if(p.length!==3) return null;
  return new Date(p[2],p[1]-1,p[0]);
}

document.addEventListener("DOMContentLoaded", function() {

  // 2) Fetch the JSON from Flask
  fetch("/api/data")
    .then(function(res) {
      return res.json();              // parse as JSON
    })
    .then(function(data) {

      // Prepare shared labels (StartDate) 
      var dates = data
        .map(function(r) { return r.StartDate; })            // extract dates
        .filter(function(d) { return d; })                   // drop nulls
        .filter(function(v,i,a) { return a.indexOf(v)===i; })// unique
        .sort(function(a,b){ return parseDate(a)-parseDate(b); }); // sort

      // === b) Count students vs offers per date ===
      var studentCounts = dates.map(function(date) {
        return data.filter(function(r) {
          return r.StartDate===date && r.Stage==="Student";
        }).length;
      });
      var offerCounts = dates.map(function(date) {
        return data.filter(function(r) {
          return r.StartDate===date && r.Stage==="Offer";
        }).length;
      });

      // Line chart: Current Student vs Enrolled
      new Chart(
        document.getElementById("chart-current-enrolled"),
        {
          type: "line",
          data: {
            labels: dates,
            datasets: [
              { label: "Students", data: studentCounts, fill: false },
              { label: "Offers",   data: offerCounts,   fill: false }
            ]
          },
          options: { responsive: true }
        }
      );

      //  Bar chart: Enrolled vs Offers total
      var totalStudents = data.filter(function(r){ return r.Stage==="Student"; }).length;
      var totalOffers   = data.filter(function(r){ return r.Stage==="Offer";   }).length;
      new Chart(
        document.getElementById("chart-enrolled-offer"),
        {
          type: "bar",
          data: {
            labels: ["Students","Offers"],
            datasets: [
              { label: "Count", data: [ totalStudents, totalOffers ] }
            ]
          },
          options: { responsive: true }
        }
      );

      //  Pie chart: Visa Breakdown
      var visaCounts = {};
      data.forEach(function(r) {
        var v = r["Visa Status"] || "Unknown"; 
        visaCounts[v] = (visaCounts[v]||0) + 1;
      });
      new Chart(
        document.getElementById("chart-visa-breakdown"),
        {
          type: "pie",
          data: {
            labels: Object.keys(visaCounts),
            datasets: [{
              data: Object.values(visaCounts),
              backgroundColor: [
                "#ff6384",
                "#36a2eb",
                "#ffce56",
                "#8a2be2",
                "#4bc0c0"
              ],
              borderColor: "#ffffff",
              borderWidth: 2,
              hoverOffset: 8
            }]
          },
          options: {
            responsive: true,
            plugins: {
              title: {
                display: true,
                text: "Visa Breakdown",
                color: "#c72c41",
                font: { size: 18, weight: "bold" }
              }
            }
          }
        }
      );

      //  Line chart: Offer Expiry Surge
      var expiryDates = data
        .map(function(r){ return r["Offer Expiry Date"]; })
        .filter(function(d){ return d; })
        .filter(function(v,i,a){ return a.indexOf(v)===i; })
        .sort(function(a,b){ return parseDate(a)-parseDate(b); });
      var expiryCounts = expiryDates.map(function(d) {
        return data.filter(function(r){ return r["Offer Expiry Date"]===d; }).length;
      });
      new Chart(
        document.getElementById("chart-offer-expiry-surge"),
        {
          type: "line",
          data: {
            labels: expiryDates,
            datasets: [{
              label: "Expiry Count",
              data: expiryCounts,
              fill: false
            }]
          },
          options: { responsive: true }
        }
      );

      //  Storyboard highlights 
      var total = data.length; 

      //  Due Payments: % opting >50% upfront fee
      var payYes = data.filter(function(r){
        return r["Do you want to pay more than 50% upfront fee?"]==="Yes";
      }).length;
      var pctPay = total ? Math.round(payYes/total*100) : 0;
      document.getElementById("story-due-payments").innerText =
        pctPay + "% opted >50% upfront fee";

      //  Course Performance: % deferral rate
      var deferYes = data.filter(function(r){
        return r["Is the offer deferred?"]==="Yes";
      }).length;
      var pctDef = total ? Math.round(deferYes/total*100) : 0;
      document.getElementById("story-course-performance").innerText =
        "-" + pctDef + "% deferral rate";

      //  Top Study Reason
      var reasonCounts = {};
      data.forEach(function(r){
        var reason = r["Study Reason"] || "Unknown";
        reasonCounts[reason] = (reasonCounts[reason]||0) + 1;
      });
      var topReason = Object.keys(reasonCounts).reduce(function(a,b){
        return reasonCounts[a]>=reasonCounts[b]?a:b;
      });
      var topPct = total ? Math.round(reasonCounts[topReason]/total*100) : 0;
      document.getElementById("story-study-reasons").innerText =
        "+" + topPct + "% chose " + topReason;

    })
    .catch(function(err){
      console.error("Data load error:", err); // log fetch errors
    });

  //  User‐profile dropdown (unchanged)
  var toggle = document.querySelector(".dropdown-toggle");
  var menu   = document.querySelector(".profile-dropdown");
  if(toggle && menu) {
    toggle.addEventListener("click", function(e){
      e.stopPropagation();
      menu.style.display = menu.style.display==="block" ? "none" : "block";
    });
    document.addEventListener("click", function(){
      if(menu.style.display==="block") menu.style.display="none";
    });
    document.getElementById("logout-link").addEventListener("click", function(e){
      e.preventDefault(); // placeholder for logout action
    });
  }

}); // end DOMContentLoaded
