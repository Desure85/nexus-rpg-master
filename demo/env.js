// Окружение «сервера» для демо на GitHub Pages. Встраивается в index.html до загрузки модулей.
(function () {
  var base = location.pathname.replace(/[^/]*$/, '');
  globalThis.__nexusEnv = {
    NODE_ENV: 'demo',
    LLM_PROVIDER: 'mock',
    DEFAULT_PROVIDER: 'mock',
    MOCK_LLM_DELAY_MS: '12',
    PAYMENTS_PROVIDER: 'mock',
    FREE_CREDITS: '300',
    DISCLAIMER_EXTRA: 'Это демо: всё хранится только в вашем браузере, а вместо настоящего ИИ отвечают заготовки. Оплата тестовая — деньги не списываются.',
    APP_URL: location.origin + base + '#',
  };
})();
