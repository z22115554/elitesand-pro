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

  SocketClient.init('practice-overlay');
  SocketClient.on('practice:overlay', (message) => {
    if (!message) return;
    engine.receive(message);
    if (message.type === 'song') root.classList.toggle('has-song', !!message.song);
    if (message.type === 'clear') root.classList.remove('has-song');
  });
})();
