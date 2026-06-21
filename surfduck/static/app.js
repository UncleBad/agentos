// SurfDuck — grid rendering and interaction logic
let currentShows = [];
let timeOffset = 0;

const guide = document.getElementById('guide');
const detail = document.getElementById('show-detail');
const searchInput = document.getElementById('search');
const timeLabel = document.getElementById('time-label');

const PROVIDER_SLUGS = {
  'Netflix': 'netflix', 'Amazon Prime Video': 'prime',
  'Hulu': 'hulu', 'Disney Plus': 'disney', 'Max': 'max',
  'Apple TV Plus': 'apple', 'Paramount Plus': 'paramount',
  'Peacock': 'peacock', 'Peacock Premium': 'peacock',
};

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

function renderBadges(services) {
  if (!services || services.length === 0) return '';
  return '<div class="streaming-badges">' +
    services.slice(0, 3).map(function(s) {
      var cls = PROVIDER_SLUGS[s] || '';
      return '<span class="badge ' + cls + '">' + escapeHtml(s) + '</span>';
    }).join('') +
    '</div>';
}

function getHourSlot(airtime) {
  if (!airtime) return -1;
  var parts = airtime.split(':').map(Number);
  if (isNaN(parts[0])) return -1;
  return parts[0] + (parts[1] >= 30 ? 0.5 : 0);
}

function updateTimeLabel() {
  var h = new Date().getHours() + timeOffset;
  var label = (h % 12 || 12) + ':00' + (h < 12 ? 'a' : 'p');
  timeLabel.textContent = label;
}

function showDetail(show) {
  var html = '<button class="detail-close" onclick="document.getElementById(\'show-detail\').classList.add(\'hidden\')">&times;</button>';
  html += '<h2>' + escapeHtml(show.name) + '</h2>';
  html += '<p><strong>' + escapeHtml(show.network || 'Unknown network') + '</strong> &mdash; ' + escapeHtml(show.time || 'TBA') + '</p>';
  if (show.title) {
    html += '<p>Episode: ' + escapeHtml(show.title) + ' (S' + show.season + 'E' + show.episode + ')</p>';
  }
  if (show.summary) {
    html += '<p class="summary">' + escapeHtml(show.summary) + '</p>';
  }
  if (show.streaming && show.streaming.length) {
    html += '<p style="margin-top:8px">Streaming on: ' + show.streaming.map(escapeHtml).join(', ') + '</p>';
  }
  detail.innerHTML = html;
  detail.classList.remove('hidden');
}

function renderGrid() {
  var channels = {};
  for (var i = 0; i < currentShows.length; i++) {
    var show = currentShows[i];
    var ch = show.network || 'Unknown';
    if (!channels[ch]) channels[ch] = [];
    channels[ch].push(show);
  }

  var channelNames = Object.keys(channels).sort();
  if (channelNames.length === 0) {
    guide.innerHTML = '<div class="guide-loading">No channels found.</div>';
    return;
  }

  var now = new Date();
  var startHour = now.getHours() + timeOffset;
  var hours = [];
  for (var h = 0; h < 8; h++) {
    hours.push((startHour + h) % 24);
  }

  var html = '<div class="guide-grid">';
  html += '<div class="time-header"></div>';
  for (var hi = 0; hi < hours.length; hi++) {
    var hh = hours[hi];
    var label = (hh % 12 || 12) + ':00' + (hh < 12 ? 'a' : 'p');
    html += '<div class="time-header">' + label + '</div>';
  }

  for (var ci = 0; ci < channelNames.length; ci++) {
    html += '<div class="channel-label">' + escapeHtml(channelNames[ci]) + '</div>';
    for (var si = 0; si < 8; si++) {
      html += '<div class="show-cell empty"></div>';
    }
  }

  html += '</div>';
  guide.innerHTML = html;

  // Fill shows into time slots
  var cells = guide.querySelectorAll('.show-cell');
  var totalCols = 8;

  for (ci = 0; ci < channelNames.length; ci++) {
    var ch = channelNames[ci];
    var shows = channels[ch];
    for (var si = 0; si < shows.length; si++) {
      var show = shows[si];
      var showHour = getHourSlot(show.time);
      if (showHour < 0) continue;

      var colOffset = showHour - startHour;
      if (colOffset < 0 || colOffset >= 8) continue;

      var cellIdx = ci * totalCols + Math.floor(colOffset);
      if (cellIdx >= cells.length) continue;

      cells[cellIdx].classList.remove('empty');
      cells[cellIdx].innerHTML =
        '<div class="show-title">' + escapeHtml(show.name) + '</div>' +
        (show.title ? '<div class="show-episode">' + escapeHtml(show.title) + '</div>' : '') +
        renderBadges(show.streaming || []);

      (function(s) {
        cells[cellIdx].addEventListener('click', function() { showDetail(s); });
      })(show);
    }
  }

  updateTimeLabel();
}

function renderSearchResults(results) {
  var html = '<div class="search-results">';
  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    html += '<div class="search-result" onclick="this.classList.toggle(\'expanded\')">';
    html += '<strong>' + escapeHtml(r.name) + '</strong>';
    if (r.year) html += '<span class="year">(' + r.year + ')</span>';
    html += '<div class="overview">' + escapeHtml(r.overview || 'No description.') + '</div>';
    html += '</div>';
  }
  html += '</div>';
  guide.innerHTML = html;
}

function loadSchedule() {
  guide.innerHTML = '<div class="guide-loading">Loading listings...</div>';
  fetch('/api/schedule')
    .then(function(resp) {
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return resp.json();
    })
    .then(function(data) {
      currentShows = data;
      if (currentShows.length === 0) {
        guide.innerHTML = '<div class="guide-loading">No listings available. Check back later.</div>';
        return;
      }
      renderGrid();
    })
    .catch(function(e) {
      guide.innerHTML = '<div class="guide-error">Failed to load: ' + e.message + '</div>';
    });
}

document.getElementById('prev-time').addEventListener('click', function() {
  timeOffset = Math.max(-12, timeOffset - 2);
  renderGrid();
});

document.getElementById('next-time').addEventListener('click', function() {
  timeOffset = Math.min(12, timeOffset + 2);
  renderGrid();
});

var searchTimeout;
searchInput.addEventListener('input', function() {
  clearTimeout(searchTimeout);
  var q = searchInput.value.trim();
  if (q.length < 2) { loadSchedule(); return; }

  searchTimeout = setTimeout(function() {
    guide.innerHTML = '<div class="guide-loading">Searching...</div>';
    fetch('/api/search?q=' + encodeURIComponent(q))
      .then(function(resp) { return resp.json(); })
      .then(function(results) {
        if (results.length === 0) {
          guide.innerHTML = '<div class="guide-loading">No results found.</div>';
          return;
        }
        renderSearchResults(results);
      })
      .catch(function() {
        guide.innerHTML = '<div class="guide-loading">Search failed.</div>';
      });
  }, 300);
});

loadSchedule();