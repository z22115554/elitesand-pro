/**
 * OBS 練唱疊加層：唯讀，跟著面板送來的 practice:overlay 畫音軌、評等與結算。
 * clientType 'practice-overlay' 豁免 PIN（鐵則 14），伺服器只把練唱資料轉給這個房間；連上時伺服器先補送外觀與目前的歌。
 */
(function () {
  'use strict';

  const root = document.getElementById('practice-stage');
  if (!root || typeof PracticeEngine === 'undefined') return;
  const t = (key, vars) => (window.I18n ? window.I18n.t(key, vars) : key);
  const engine = PracticeEngine.createPracticeEngine({ role: 'source', root, t });

  const showcase = root.querySelector('[data-practice-showcase]');
  let trackId = null;
  function showRecap(recap) {
    if (typeof PracticeShowcase !== 'undefined') PracticeShowcase.render(showcase, recap, t);
  }

  SocketClient.init('practice-overlay');
  SocketClient.on('practice:overlay', (message) => {
    if (!message) return;
    if (message.type === 'song') {
      trackId = message.song ? (message.song.trackId || message.song.key) : null;
      showRecap(null);
    }
    if (message.type === 'clear' || message.type === 'seek') {
      if (message.type === 'clear') trackId = null;
      showRecap(null);
    }
    if (message.type === 'recap') {
      if (!message.recap || (trackId && message.recap.trackId === trackId)) showRecap(message.recap);
      return;
    }
    engine.receive(message);
    if (message.type === 'song') root.classList.toggle('has-song', !!message.song);
    if (message.type === 'clear') root.classList.remove('has-song');
  });
})();
