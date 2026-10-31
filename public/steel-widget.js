/*
 * Steel — site chat widget.
 *
 * <script src="https://<steel>/steel-widget.js" data-key="stw_..." async></script>
 *
 * Plain script, no dependencies. The UI lives in a Shadow DOM and its CSS is
 * adopted through the CSSOM, so a strict Content-Security-Policy on the host
 * page (no inline styles) does not break it. The visitor is identified by a
 * random token kept in a first-party cookie (and localStorage as a backup);
 * every request is cross-origin and carries no cookies. Public API:
 * window.SteelChat.open() / close() / toggle().
 */
;(function () {
  'use strict'

  if (window.SteelChat) return

  var script =
    document.currentScript || document.querySelector('script[data-key][src*="steel-widget"]')
  if (!script) return
  var key = script.getAttribute('data-key')
  if (!key) return
  var base = new URL(script.src).origin

  var POLL_OPEN_MS = 3000
  var POLL_HIDDEN_MS = 15000
  var POLL_CLOSED_MS = 30000
  var COOKIE = 'steel_wv_' + key.replace(/[^a-zA-Z0-9]/g, '').slice(-12)
  var COOKIE_DAYS = 180

  // ── storage ────────────────────────────────────────────────────────────
  function readCookie() {
    var match = document.cookie.match(new RegExp('(?:^|; )' + COOKIE + '=([^;]*)'))
    return match ? decodeURIComponent(match[1]) : null
  }
  function getToken() {
    var token = readCookie()
    if (token) return token
    try {
      return window.localStorage.getItem(COOKIE)
    } catch (e) {
      return null
    }
  }
  function setToken(token) {
    var expires = new Date(Date.now() + COOKIE_DAYS * 864e5).toUTCString()
    document.cookie =
      COOKIE + '=' + encodeURIComponent(token) + '; expires=' + expires + '; path=/; SameSite=Lax' +
      (location.protocol === 'https:' ? '; Secure' : '')
    try {
      window.localStorage.setItem(COOKIE, token)
    } catch (e) {
      /* storage blocked */
    }
  }

  // ── api ────────────────────────────────────────────────────────────────
  function api(path, options) {
    options = options || {}
    var headers = { 'Content-Type': 'application/json' }
    var token = getToken()
    if (token) headers['X-Steel-Widget-Token'] = token
    return fetch(base + '/api/widget/' + path + (path.indexOf('?') === -1 ? '?' : '&') + 'key=' + encodeURIComponent(key) + (options.query || ''), {
      method: options.method || 'GET',
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials: 'omit',
      cache: 'no-store',
      mode: 'cors',
    }).then(function (response) {
      return response.json().then(
        function (json) {
          if (!response.ok || !json.success) {
            var error = new Error((json && json.error && json.error.message) || 'Falha na conexão')
            error.code = json && json.error && json.error.code
            throw error
          }
          return json.data
        },
        function () {
          throw new Error('Falha na conexão')
        },
      )
    })
  }

  // ── ui ─────────────────────────────────────────────────────────────────
  var CSS =
    ':host{all:initial}*{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}' +
    '.launcher{position:fixed;bottom:20px;width:56px;height:56px;border-radius:50%;border:0;cursor:pointer;background:var(--accent);color:#fff;box-shadow:0 6px 20px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;z-index:2147483000}' +
    '.launcher:focus-visible,button:focus-visible,textarea:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}' +
    '.launcher svg{width:26px;height:26px}.dot{position:absolute;top:2px;right:2px;width:14px;height:14px;border-radius:50%;background:#ef4444;border:2px solid #fff;display:none}.dot.on{display:block}' +
    '.right{right:20px}.left{left:20px}' +
    '.panel{position:fixed;bottom:88px;width:360px;max-width:calc(100vw - 24px);height:520px;max-height:calc(100vh - 110px);background:#fff;color:#111827;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.28);display:none;flex-direction:column;overflow:hidden;z-index:2147483000}' +
    '.panel.open{display:flex}' +
    '.head{background:var(--accent);color:#fff;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:8px}' +
    '.head h2{margin:0;font-size:15px;font-weight:600}.head button{background:transparent;border:0;color:#fff;cursor:pointer;font-size:20px;line-height:1;padding:4px}' +
    '.notice{background:#fef3c7;color:#78350f;font-size:12px;padding:8px 12px;display:none}.notice.on{display:block}' +
    '.log{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;background:#f9fafb}' +
    '.msg{max-width:82%;padding:8px 11px;border-radius:12px;font-size:14px;line-height:1.4;white-space:pre-wrap;word-wrap:break-word}' +
    '.msg.visitor{align-self:flex-end;background:var(--accent);color:#fff;border-bottom-right-radius:3px}' +
    '.msg.agent,.msg.ai{align-self:flex-start;background:#fff;border:1px solid #e5e7eb;border-bottom-left-radius:3px}' +
    '.msg.system{align-self:center;background:transparent;color:#6b7280;font-size:12px;text-align:center}' +
    '.foot{border-top:1px solid #e5e7eb;padding:8px;display:flex;gap:8px;align-items:flex-end;background:#fff}' +
    '.foot textarea{flex:1;resize:none;border:1px solid #d1d5db;border-radius:8px;padding:8px 10px;font-size:14px;max-height:96px;min-height:38px}' +
    '.send{background:var(--accent);color:#fff;border:0;border-radius:8px;padding:9px 14px;font-size:14px;cursor:pointer}.send:disabled{opacity:.55;cursor:default}' +
    '.form{padding:16px;display:flex;flex-direction:column;gap:10px;overflow-y:auto}' +
    '.form label{font-size:12px;color:#374151;display:flex;flex-direction:column;gap:4px}' +
    '.form input{border:1px solid #d1d5db;border-radius:8px;padding:9px 10px;font-size:14px}' +
    '.form .send{padding:10px}' +
    '.err{color:#b91c1c;font-size:12px;min-height:16px}' +
    '.links{padding:6px 12px;font-size:12px;text-align:center;background:#fff;border-top:1px solid #f3f4f6;display:none}.links.on{display:block}.links a{color:var(--accent)}' +
    '.survey{padding:12px;background:#fff;border-top:1px solid #e5e7eb;display:none;font-size:13px}.survey.on{display:block}' +
    '.scale{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.scale button{width:32px;height:32px;border:1px solid #d1d5db;background:#fff;border-radius:6px;cursor:pointer;font-size:13px}.scale button:hover{background:var(--accent);color:#fff}' +
    '.hidden{display:none!important}'

  var ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>'

  function el(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text) node.textContent = text
    return node
  }

  var config = null
  var host, root, ui
  var isOpen = false
  var cursor = null
  var seen = {}
  var timer = null
  var unread = false
  var conversation = 'NONE'
  var surveyShown = false

  function build() {
    host = document.createElement('div')
    host.setAttribute('data-steel-widget', '')
    document.body.appendChild(host)
    root = host.attachShadow({ mode: 'open' })

    if (window.CSSStyleSheet && 'adoptedStyleSheets' in Document.prototype) {
      var sheet = new CSSStyleSheet()
      sheet.replaceSync(CSS)
      root.adoptedStyleSheets = [sheet]
    } else {
      var style = document.createElement('style')
      style.textContent = CSS
      root.appendChild(style)
    }

    var side = config.position === 'LEFT' ? 'left' : 'right'
    var wrap = el('div')
    wrap.style.setProperty('--accent', config.accentColor)

    var launcher = el('button', 'launcher ' + side)
    launcher.type = 'button'
    launcher.setAttribute('aria-label', config.title)
    launcher.innerHTML = ICON
    var dot = el('span', 'dot')
    launcher.appendChild(dot)

    var panel = el('section', 'panel ' + side)
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', config.title)
    var head = el('div', 'head')
    head.appendChild(el('h2', '', config.title))
    var close = el('button', '', '×')
    close.type = 'button'
    close.setAttribute('aria-label', 'Fechar o chat')
    head.appendChild(close)

    var notice = el('div', 'notice')
    var log = el('div', 'log')
    log.setAttribute('role', 'log')
    log.setAttribute('aria-live', 'polite')

    var survey = el('div', 'survey')
    var links = el('div', 'links')

    var foot = el('form', 'foot')
    var input = el('textarea')
    input.rows = 1
    input.placeholder = 'Escreva sua mensagem'
    input.setAttribute('aria-label', 'Mensagem')
    input.maxLength = 2000
    var send = el('button', 'send', 'Enviar')
    send.type = 'submit'
    foot.appendChild(input)
    foot.appendChild(send)

    var form = el('form', 'form hidden')
    var fields = {}
    function field(name, label, type, required) {
      var wrapLabel = el('label', '', label)
      var control = el('input')
      control.type = type
      control.required = required
      control.maxLength = 200
      wrapLabel.appendChild(control)
      form.appendChild(wrapLabel)
      fields[name] = control
    }
    field('name', 'Seu nome', 'text', true)
    if (config.preChatAskEmail) field('email', 'Seu e-mail', 'email', true)
    if (config.preChatAskPhone) field('phone', 'Seu telefone', 'tel', true)
    var formError = el('div', 'err')
    var start = el('button', 'send', 'Iniciar conversa')
    start.type = 'submit'
    form.appendChild(formError)
    form.appendChild(start)

    panel.appendChild(head)
    panel.appendChild(notice)
    panel.appendChild(log)
    panel.appendChild(form)
    panel.appendChild(survey)
    panel.appendChild(links)
    panel.appendChild(foot)
    wrap.appendChild(launcher)
    wrap.appendChild(panel)
    root.appendChild(wrap)

    ui = {
      launcher: launcher, dot: dot, panel: panel, notice: notice, log: log, input: input, send: send,
      foot: foot, form: form, fields: fields, formError: formError, survey: survey, links: links,
    }

    if (config.offlineMessage) {
      notice.textContent = config.offlineMessage
      notice.classList.add('on')
    }
    if (config.portalUrl) {
      var link = el('a', '', 'Abrir um chamado no portal do solicitante')
      link.href = config.portalUrl
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      links.appendChild(link)
      links.classList.add('on')
    }

    launcher.addEventListener('click', toggle)
    close.addEventListener('click', closePanel)
    foot.addEventListener('submit', function (event) {
      event.preventDefault()
      submitMessage(ui.input.value, null)
    })
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        foot.requestSubmit()
      }
    })
    form.addEventListener('submit', function (event) {
      event.preventDefault()
      var details = {}
      Object.keys(fields).forEach(function (name) {
        details[name] = fields[name].value.trim()
      })
      ui.pendingDetails = details
      form.classList.add('hidden')
      foot.classList.remove('hidden')
      ui.input.focus()
      addMessage({ id: 'welcome', from: 'agent', text: config.welcomeMessage })
    })

    addMessage({ id: 'welcome', from: 'agent', text: config.welcomeMessage })
    needsPreChat() ? showPreChat() : null
  }

  function needsPreChat() {
    return config.preChatEnabled && !getToken() && !ui.pendingDetails
  }

  function showPreChat() {
    ui.log.innerHTML = ''
    seen = {}
    ui.form.classList.remove('hidden')
    ui.foot.classList.add('hidden')
  }

  function addMessage(message) {
    if (seen[message.id]) return
    seen[message.id] = true
    var node = el('div', 'msg ' + message.from, message.text)
    ui.log.appendChild(node)
    ui.log.scrollTop = ui.log.scrollHeight
  }

  function renderSurvey(survey) {
    if (!survey) {
      ui.survey.classList.remove('on')
      surveyShown = false
      return
    }
    if (surveyShown) return
    surveyShown = true
    ui.survey.innerHTML = ''
    ui.survey.appendChild(el('div', '', survey.question))
    var scale = el('div', 'scale')
    for (var n = survey.scaleMin; n <= survey.scaleMax; n++) {
      ;(function (score) {
        var button = el('button', '', String(score))
        button.type = 'button'
        button.addEventListener('click', function () {
          api('survey', { method: 'POST', body: { score: score } }).then(
            function () {
              ui.survey.textContent = 'Obrigado pela sua avaliação!'
              setTimeout(function () {
                ui.survey.classList.remove('on')
              }, 4000)
            },
            function (error) {
              ui.survey.textContent = error.message
            },
          )
        })
        scale.appendChild(button)
      })(n)
    }
    ui.survey.appendChild(scale)
    ui.survey.classList.add('on')
  }

  function poll() {
    if (!getToken()) return Promise.resolve()
    return api('messages', { query: cursor ? '&after=' + encodeURIComponent(cursor) : '' }).then(
      function (data) {
        conversation = data.conversation
        var fresh = 0
        data.messages.forEach(function (message) {
          if (!seen[message.id]) {
            if (message.from !== 'visitor') fresh++
            addMessage(message)
          }
          cursor = message.createdAt
        })
        if (fresh > 0 && !isOpen) {
          unread = true
          ui.dot.classList.add('on')
        }
        renderSurvey(data.survey)
      },
      function () {
        /* offline or transient: try again on the next tick */
      },
    )
  }

  function schedule() {
    clearTimeout(timer)
    var wait = isOpen ? (document.hidden ? POLL_HIDDEN_MS : POLL_OPEN_MS) : POLL_CLOSED_MS
    timer = setTimeout(function () {
      poll().then(schedule, schedule)
    }, wait)
  }

  function submitMessage(text, extra) {
    text = (text || '').trim()
    if (!text) return
    ui.send.disabled = true
    var body = { text: text, pageUrl: location.origin + location.pathname }
    var details = ui.pendingDetails || extra
    if (details) {
      if (details.name) body.name = details.name
      if (details.email) body.email = details.email
      if (details.phone) body.phone = details.phone
    }
    api('messages', { method: 'POST', body: body }).then(
      function (data) {
        if (data.token) setToken(data.token)
        ui.input.value = ''
        ui.pendingDetails = null
        return poll()
      },
      function (error) {
        addMessage({ id: 'err-' + Date.now(), from: 'system', text: error.message })
      },
    ).then(function () {
      ui.send.disabled = false
      ui.input.focus()
      schedule()
    })
  }

  function openPanel() {
    isOpen = true
    ui.panel.classList.add('open')
    unread = false
    ui.dot.classList.remove('on')
    poll().then(schedule, schedule)
    if (!ui.form.classList.contains('hidden')) {
      ui.fields.name.focus()
    } else {
      ui.input.focus()
    }
  }

  function closePanel() {
    isOpen = false
    ui.panel.classList.remove('open')
    schedule()
  }

  function toggle() {
    isOpen ? closePanel() : openPanel()
  }

  window.SteelChat = {
    open: function () {
      if (ui && !isOpen) openPanel()
    },
    close: function () {
      if (ui && isOpen) closePanel()
    },
    toggle: function () {
      if (ui) toggle()
    },
  }

  function init() {
    api('config').then(
      function (data) {
        config = data
        build()
        if (getToken()) poll().then(schedule, schedule)
      },
      function () {
        /* widget disabled, key unknown or this site is not allowed: stay hidden */
        delete window.SteelChat
      },
    )
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
