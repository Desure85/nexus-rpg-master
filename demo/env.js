// Окружение «сервера» для демо на GitHub Pages. Встраивается в index.html до загрузки модулей.
(function () {
  var base = location.pathname.replace(/[^/]*$/, '');
  globalThis.__nexusEnv = {
    NODE_ENV: 'demo',
    DEFAULT_PROVIDER: 'mock',
    GEMINI_REST: '1',
    ALLOW_BYOK_CUSTOM_URL: 'true',
    MOCK_LLM_DELAY_MS: '18',
    MOCK_STYLE: 'demo',
    PAYMENTS_PROVIDER: 'mock',
    FREE_CREDITS: '300',
    DISCLAIMER_EXTRA: 'Это демо: всё хранится только в вашем браузере. По умолчанию вместо ИИ отвечают заготовки; можно подключить свой ключ ИИ в настройках пространства — запросы пойдут из вашего браузера напрямую провайдеру. Оплата тестовая — деньги не списываются.',
    APP_URL: location.origin + base + '#',
  };
})();
