// =============================================
// CONFIGURAÇÕES E CONSTANTES
// =============================================
const CONFIG = {
  API_BASE_URL: "/api/cnpj",
  DEBOUNCE_DELAY: 500,
  REQUEST_TIMEOUT: 30000,
  MAX_RETRIES: 2,
  RETRY_DELAY: 1000,
  MAX_SEARCH_HISTORY: 50,
  // Nova configuração para ambiente
  ENV: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'development' : 'production',
  // Configurações de rate limit
  RATE_LIMIT_DELAY: 60000, // 60 segundos padrão
  AUTO_RETRY_ENABLED: true, // Se deve retornar automaticamente
  // Versão do app para controle de cache
  APP_VERSION: '1.3.0'
};

// =============================================
// VERIFICADOR DE ATUALIZAÇÕES
// =============================================
class UpdateManager {
  static STORAGE_KEY = 'app_version';
  
  static checkForUpdates() {
    const storedVersion = localStorage.getItem(this.STORAGE_KEY);
    const currentVersion = CONFIG.APP_VERSION;
    
    if (storedVersion !== currentVersion) {
      console.log('🔄 Nova versão detectada:', currentVersion);
      
      // Limpar caches específicos se necessário
      this.clearOldCaches();
      
      // Atualizar versão armazenada
      localStorage.setItem(this.STORAGE_KEY, currentVersion);
      
      // Forçar atualização do Service Worker
      this.updateServiceWorker();
      
      return true;
    }
    
    return false;
  }
  
  static clearOldCaches() {
    // Limpar dados que podem causar conflitos entre versões
    try {
      // Limpar apenas dados específicos se necessário
      // localStorage.removeItem('some_old_key');
      console.log('🧹 Cache limpo para nova versão');
    } catch (error) {
      console.warn('Erro ao limpar cache antigo:', error);
    }
  }
  
  static updateServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(registration => {
        registration.update().then(() => {
          console.log('✅ Service Worker atualizado');
        }).catch(error => {
          console.warn('❌ Erro ao atualizar Service Worker:', error);
        });
      });
    }
  }
  
  static forceReload() {
    if (confirm('Uma nova versão do app está disponível. Deseja recarregar para aplicar as atualizações?')) {
      window.location.reload();
    }
  }
}

// =============================================
// GERENCIADOR DE RATE LIMIT COM TIMER
// =============================================
class RateLimitManager {
  static STORAGE_KEY = 'cnpj_rate_limit';
  static timerInterval = null;
  static currentTimer = null;

  static setRateLimit(seconds) {
    const resetTime = Date.now() + (seconds * 1000);
    localStorage.setItem(this.STORAGE_KEY, resetTime.toString());
    this.startTimer(seconds);
  }

  static isRateLimited() {
    const resetTime = localStorage.getItem(this.STORAGE_KEY);
    if (!resetTime) return false;
    
    return Date.now() < parseInt(resetTime);
  }

  static getRemainingTime() {
    const resetTime = localStorage.getItem(this.STORAGE_KEY);
    if (!resetTime) return 0;
    
    const remaining = parseInt(resetTime) - Date.now();
    return Math.max(0, Math.ceil(remaining / 1000));
  }

  static clearRateLimit() {
    localStorage.removeItem(this.STORAGE_KEY);
    this.stopTimer();
  }

  static startTimer(seconds) {
    this.stopTimer(); // Para qualquer timer existente
    
    let remaining = seconds;
    this.currentTimer = {
      startTime: Date.now(),
      duration: seconds * 1000,
      remaining: seconds
    };

    this.timerInterval = setInterval(() => {
      remaining--;
      this.currentTimer.remaining = remaining;

      // Atualizar UI se disponível
      if (typeof uiManager !== 'undefined' && uiManager.updateTimerDisplay) {
        uiManager.updateTimerDisplay(remaining);
      }

      if (remaining <= 0) {
        this.stopTimer();
        this.clearRateLimit();
        
        // Executar retry automático se configurado
        if (CONFIG.AUTO_RETRY_ENABLED && typeof uiManager !== 'undefined') {
          uiManager.handleAutoRetry();
        }
      }
    }, 1000);
  }

  static stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
      this.currentTimer = null;
    }
  }

  static getTimerInfo() {
    return this.currentTimer;
  }
}

// =============================================
// VALIDAÇÃO DE CNPJ (ALGORITMO OFICIAL)
// =============================================
// Suporta CNPJ numérico e alfanumérico (IN RFB 2.229/2024, vigente desde jul/2026):
// 12 primeiras posições [0-9A-Z] + 2 dígitos verificadores numéricos.
class CNPJValidator {
  static clean(cnpj) {
    return String(cnpj || "")
      .toUpperCase()
      .replace(/^\s*CNPJ\s*[:\-]?/, "") // texto colado como "CNPJ: 12.345..."
      .replace(/[^0-9A-Z]/g, "");
  }

  static format(cnpj) {
    const cleaned = this.clean(cnpj);
    if (cleaned.length !== 14) return cnpj;

    return cleaned.replace(/^(.{2})(.{3})(.{3})(.{4})(.{2})$/, "$1.$2.$3/$4-$5");
  }

  // Cada caractere vale (código ASCII - 48): dígitos 0-9, letras A=17 ... Z=42.
  // Pesos 2..9 da direita para a esquerda, módulo 11.
  static calcDV(base) {
    let soma = 0;
    let peso = 2;
    for (let i = base.length - 1; i >= 0; i--) {
      soma += (base.charCodeAt(i) - 48) * peso;
      peso = peso === 9 ? 2 : peso + 1;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  }

  static validate(cnpj) {
    const cleaned = this.clean(cnpj);

    if (cleaned.length !== 14) {
      return { isValid: false, error: "CNPJ deve conter 14 caracteres" };
    }

    if (!/^[0-9A-Z]{12}\d{2}$/.test(cleaned)) {
      return { isValid: false, error: "Os dois últimos caracteres do CNPJ devem ser números" };
    }

    if (/^(\d)\1+$/.test(cleaned)) {
      return { isValid: false, error: "CNPJ com dígitos repetidos é inválido" };
    }

    if (this.calcDV(cleaned.substring(0, 12)) !== Number(cleaned[12]) ||
        this.calcDV(cleaned.substring(0, 13)) !== Number(cleaned[13])) {
      return { isValid: false, error: "Dígito verificador inválido" };
    }

    return { isValid: true, cleaned };
  }
}

// =============================================
// GERENCIADOR DE HISTÓRICO DE PESQUISAS
// =============================================
class SearchHistoryManager {
  static STORAGE_KEY = 'cnpj_search_history';
  static MAX_ITEMS = CONFIG.MAX_SEARCH_HISTORY;

  static getHistory() {
    try {
      const history = localStorage.getItem(this.STORAGE_KEY);
      return history ? JSON.parse(history) : {};
    } catch (error) {
      console.error('Erro ao carregar histórico:', error);
      return {};
    }
  }

  static saveToHistory(cnpj, data) {
    try {
      const history = this.getHistory();
      const timestamp = new Date().toISOString();
      
      // Adicionar nova pesquisa
      history[cnpj] = {
        data: data,
        timestamp: timestamp,
        companyName: data.company?.name || 'Nome não disponível'
      };

      // Manter apenas os MAX_ITEMS mais recentes
      const entries = Object.entries(history);
      if (entries.length > this.MAX_ITEMS) {
        const sorted = entries.sort((a, b) => 
          new Date(b[1].timestamp) - new Date(a[1].timestamp)
        );
        const toKeep = sorted.slice(0, this.MAX_ITEMS);
        const newHistory = Object.fromEntries(toKeep);
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(newHistory));
      } else {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(history));
      }

      return true;
    } catch (error) {
      console.error('Erro ao salvar no histórico:', error);
      return false;
    }
  }

  static clearHistory() {
    try {
      localStorage.removeItem(this.STORAGE_KEY);
      return true;
    } catch (error) {
      console.error('Erro ao limpar histórico:', error);
      return false;
    }
  }

  static getHistoryCount() {
    const history = this.getHistory();
    return Object.keys(history).length;
  }

  static getHistoryList() {
    const history = this.getHistory();
    return Object.entries(history).map(([cnpj, item]) => ({
      cnpj,
      ...item
    }));
  }
}

// =============================================
// GERENCIADOR DE EXPORTAÇÃO ATUALIZADO - DADOS COMPLETOS
// =============================================
class ExportManager {
  // Separador ";" e BOM UTF-8: padrão que o Excel em português abre direto,
  // com colunas e acentos corretos.
  static exportToCSV(selections) {
    if (!selections || selections.length === 0) return null;

    const escape = (value) => {
      const text = String(value ?? '');
      return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };

    const headers = this.getAllHeaders();
    const rows = selections.map(item => {
      const row = this.formatRowData(item);
      return headers.map(header => escape(row[header])).join(';');
    });
    return '﻿' + [headers.map(escape).join(';'), ...rows].join('\r\n');
  }

  static exportToJSON(selections) {
    const exportData = {
      exported_at: new Date().toISOString(),
      total_companies: selections.length,
      selections: selections.map(item => ({
        cnpj: item.cnpj,
        company_name: item.data.company?.name,
        timestamp: item.timestamp,
        exported_at: new Date().toISOString()
      })),
      data: selections.reduce((acc, item) => {
        acc[item.cnpj] = item.data;
        return acc;
      }, {})
    };

    return JSON.stringify(exportData, null, 2);
  }

  static async exportToExcel(selections) {
    if (!selections || selections.length === 0) return null;

    try {
      const wb = XLSX.utils.book_new();
      
      // Dados completos em uma única planilha
      const completeData = selections.map(item => this.formatRowData(item, true));
      const ws = XLSX.utils.json_to_sheet(completeData);
      
      XLSX.utils.book_append_sheet(wb, ws, "Dados Completos");
      const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      return excelBuffer;

    } catch (error) {
      console.error('Erro ao gerar Excel:', error);
      return this.exportToCSV(selections);
    }
  }

  static getAllHeaders() {
    return [
      'CNPJ', 'Razão Social', 'Nome Fantasia', 'Situação Cadastral', 
      'Data Abertura', 'Data Situação Cadastral', 'Data Última Atualização',
      'Matriz/Filial', 'Natureza Jurídica', 'Porte Empresa', 'Capital Social',
      'Optante Simples', 'Data Opção Simples', 'MEI', 'Data Opção MEI',
      'Logradouro', 'Número', 'Complemento', 'Bairro', 'Cidade', 'Estado', 'CEP', 'País',
      'Telefones', 'Emails', 'CNAE Principal', 'Código CNAE Principal',
      'CNAEs Secundários', 'Inscrições Estaduais', 'Sócios'
    ];
  }

  static formatRowData(item, forExcel = false) {
    const data = item.data;
    const capitalSocial = data.company?.equity ? `R$ ${Formatters.currency(data.company.equity)}` : '';
    
    // Formatando listas
    const secondaryActivities = data.sideActivities && data.sideActivities.length > 0 
      ? data.sideActivities.map(act => `${act.id} - ${act.text}`).join(forExcel ? '; ' : '\n')
      : '';

    const registrations = data.registrations && data.registrations.length > 0
      ? data.registrations.map(reg => `${reg.number} (${reg.state})`).join(forExcel ? '; ' : '\n')
      : '';

    const members = data.company?.members && data.company.members.length > 0
      ? data.company.members.map(member => 
          `${member.person?.name} - ${member.role?.text}`
        ).join(forExcel ? '; ' : '\n')
      : '';

    return {
      // Formatado para o Excel não converter em número e perder zeros à esquerda
      'CNPJ': data.taxId ? Formatters.CNPJ(data.taxId) : '',
      'Razão Social': data.company?.name || '',
      'Nome Fantasia': data.alias || '',
      'Situação Cadastral': data.status?.text || '',
      'Data Abertura': Formatters.date(data.founded) || '',
      'Data Situação Cadastral': Formatters.date(data.statusDate) || '',
      'Data Última Atualização': Formatters.date(data.updated) || '',
      'Matriz/Filial': data.head ? 'Matriz' : 'Filial',
      'Natureza Jurídica': data.company?.nature?.text || '',
      'Porte Empresa': data.company?.size?.text || '',
      'Capital Social': capitalSocial,
      'Optante Simples': data.company?.simples?.optant ? 'SIM' : 'NÃO',
      'Data Opção Simples': Formatters.date(data.company?.simples?.since) || '',
      'MEI': data.company?.simei?.optant ? 'SIM' : 'NÃO',
      'Data Opção MEI': Formatters.date(data.company?.simei?.since) || '',
      'Logradouro': data.address?.street || '',
      'Número': data.address?.number || '',
      'Complemento': data.address?.details || '',
      'Bairro': data.address?.district || '',
      'Cidade': data.address?.city || '',
      'Estado': data.address?.state || '',
      'CEP': Formatters.CEP(data.address?.zip) || '',
      'País': Formatters.country(data.address?.country),
      'Telefones': this.formatPhones(data.phones),
      'Emails': this.getPrimaryEmail(data.emails),
      'CNAE Principal': data.mainActivity?.text || '',
      'Código CNAE Principal': data.mainActivity?.id || '',
      'CNAEs Secundários': secondaryActivities,
      'Inscrições Estaduais': registrations,
      'Sócios': members
    };
  }

  static downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  static downloadExcelFile(excelBuffer, filename) {
    const blob = new Blob([excelBuffer], { 
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  static formatPhones(phones) {
    if (!phones || !Array.isArray(phones)) return '';
    return phones.map(phone => 
      phone.area && phone.number ? `(${phone.area}) ${phone.number}` : phone.number
    ).filter(phone => phone).join('; ');
  }

  static getPrimaryEmail(emails) {
    if (!emails || !Array.isArray(emails) || emails.length === 0) return '';
    const corporateEmail = emails.find(email => email.ownership === 'CORPORATE');
    return (corporateEmail || emails[0])?.address || '';
  }

}

// =============================================
// GERENCIADOR DE ESTADO
// =============================================
class AppState {
  constructor() {
    this.currentTheme = localStorage.getItem("theme") || "dark";
    this.lastSearch = null;
    this.isLoading = false;
    this.retryCount = 0;
    this.exportSelections = new Set();
    this.pendingSearch = null;
  }

  setTheme(theme) {
    this.currentTheme = theme;
    localStorage.setItem("theme", theme);
  }

  setLoading(loading) {
    this.isLoading = loading;
  }

  setLastSearch(cnpj) {
    this.lastSearch = cnpj;
  }

  setPendingSearch(cnpj) {
    this.pendingSearch = cnpj;
  }

  clearPendingSearch() {
    this.pendingSearch = null;
  }

  toggleExportSelection(cnpj) {
    if (this.exportSelections.has(cnpj)) {
      this.exportSelections.delete(cnpj);
    } else {
      this.exportSelections.add(cnpj);
    }
  }

  selectAllExport(history) {
    this.exportSelections = new Set(history.map(item => item.cnpj));
  }

  deselectAllExport() {
    this.exportSelections.clear();
  }

  getSelectedExports(history) {
    return history.filter(item => this.exportSelections.has(item.cnpj));
  }
}

// =============================================
// GERENCIADOR DE API
// =============================================
class ApiManager {
  static async fetchCNPJ(cnpj) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);

    try {
      const response = await fetch(`${CONFIG.API_BASE_URL}?cnpj=${cnpj}`, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'Cache-Control': 'no-cache'
        }
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const waitTime = retryAfter ? parseInt(retryAfter) : 60;
          throw new Error(`RATE_LIMIT:${waitTime}`);
        }
        const body = await response.json().catch(() => null);
        const error = new Error(body?.message || `HTTP ${response.status}: ${response.statusText}`);
        error.status = response.status;
        throw error;
      }

      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.message || "Erro na consulta");
      }

      return data.data;
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        throw new Error("Tempo limite excedido na consulta");
      }
      
      throw error;
    }
  }
}

// =============================================
// FORMATADORES
// =============================================
class Formatters {
  static CNPJ(cnpj) {
    return CNPJValidator.format(cnpj);
  }

  static CEP(cep) {
    if (!cep) return "";
    const cleaned = cep.replace(/\D/g, "");
    return cleaned.replace(/(\d{5})(\d{3})/, "$1-$2");
  }

  static phone(phone) {
    if (!phone) return "";
    const cleaned = phone.replace(/\D/g, "");
    
    if (cleaned.length === 11) {
      return cleaned.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
    } else if (cleaned.length === 10) {
      return cleaned.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
    } else if (cleaned.length === 8) {
      return cleaned.replace(/(\d{4})(\d{4})/, "$1-$2");
    }
    
    return phone;
  }

  // "AAAA-MM-DD" é interpretado como UTC pelo new Date(), o que no fuso
  // do Brasil exibe o dia anterior. Datas puras viram data local.
  static parseDate(value) {
    if (!value) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
    const date = match
      ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
      : new Date(value);
    return isNaN(date.getTime()) ? null : date;
  }

  static date(dateString) {
    if (!dateString) return "";
    const date = this.parseDate(dateString);
    return date ? date.toLocaleDateString("pt-BR") : String(dateString);
  }

  static dateTime(dateTimeString) {
    if (!dateTimeString) return "";
    const date = this.parseDate(dateTimeString);
    return date ? date.toLocaleString("pt-BR") : String(dateTimeString);
  }

  static currency(value) {
    if (!value) return "0,00";
    try {
      const number = typeof value === 'string' ? 
        parseFloat(value.replace('R$', '').replace('.', '').replace(',', '.')) : 
        parseFloat(value);
      
      return number.toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    } catch (e) {
      console.warn("Erro ao formatar moeda:", value, e);
      return "0,00";
    }
  }

  // CNAE "6422100" -> "6422-1/00"
  static cnae(id) {
    const digits = String(id ?? "").replace(/\D/g, "");
    return digits.length === 7
      ? digits.replace(/(\d{4})(\d)(\d{2})/, "$1-$2/$3")
      : String(id ?? "");
  }

  static yearsSince(dateString) {
    const date = this.parseDate(dateString);
    if (!date) return null;
    const now = new Date();
    let years = now.getFullYear() - date.getFullYear();
    if (now < new Date(now.getFullYear(), date.getMonth(), date.getDate())) years--;
    return years;
  }

  static relativeDate(dateString) {
    const date = this.parseDate(dateString);
    if (!date) return "";
    const days = Math.floor((Date.now() - date.getTime()) / 86400000);
    if (days <= 0) return "hoje";
    if (days === 1) return "ontem";
    if (days < 30) return `há ${days} dias`;
    return this.date(dateString);
  }

  // A API devolve o país como texto; históricos antigos podem ter objeto { name }
  static country(country) {
    if (!country) return "";
    return typeof country === "string" ? country : country.name || "";
  }

  static time(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  }
}

// =============================================
// GERENCIADOR DE UI ATUALIZADO
// =============================================
class UIManager {
  constructor() {
    this.elements = this.initializeElements();
    this.bindEvents();
    this.initializeApp();
  }

  initializeElements() {
    return {
      cnpjInput: document.getElementById("cnpjInput"),
      searchBtn: document.getElementById("searchBtn"),
      clearBtn: document.getElementById("clearBtn"),
      errorMessage: document.getElementById("errorMessage"),
      loading: document.getElementById("loading"),
      result: document.getElementById("result"),
      partnersCard: document.getElementById("partnersCard"),
      partnersList: document.getElementById("partnersList"),
      themeToggle: document.getElementById("themeToggle"),
      completeData: document.getElementById("completeData"),
      summaryCard: document.getElementById("summaryCard"),
      recentSearches: document.getElementById("recentSearches"),
      recentList: document.getElementById("recentList"),
      
      // Elementos de exportação
      exportList: document.getElementById("exportList"),
      selectAllBtn: document.getElementById("selectAllBtn"),
      deselectAllBtn: document.getElementById("deselectAllBtn"),
      clearAllBtn: document.getElementById("clearAllBtn"),
      exportExcelBtn: document.getElementById("exportExcelBtn"),
      exportCSVBtn: document.getElementById("exportCSVBtn"),
      exportJSONBtn: document.getElementById("exportJSONBtn"),
      exportStats: document.getElementById("exportStats"),
      selectionStats: document.getElementById("selectionStats")
    };
  }

  initializeApp() {
    // Verificar atualizações
    if (UpdateManager.checkForUpdates()) {
      console.log('🔄 App atualizado para versão', CONFIG.APP_VERSION);
    }
    
    this.initializeTelemetry();
    this.initializeRateLimitCheck();
    this.loadExportHistory();
    this.renderRecentSearches();
  }

  bindEvents() {
    // Evento de pesquisa
    this.elements.searchBtn.addEventListener("click", () => this.handleSearch());
    
    // Enter no input
    this.elements.cnpjInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        this.handleSearch();
      }
    });

    // Esc limpa a pesquisa
    this.elements.cnpjInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.clearSearch();
      }
    });

    // Input com debounce e formatação automática
    this.elements.cnpjInput.addEventListener("input", (e) => {
      this.handleInputFormat(e);
      this.updateClearButton();
    });

    // Botão limpar
    this.elements.clearBtn.addEventListener("click", () => this.clearSearch());

    // Toggle de tema
    this.elements.themeToggle.addEventListener("click", () => this.toggleTheme());

    // Tabs
    document.querySelectorAll(".tab-button").forEach((button) => {
      button.addEventListener("click", (e) => {
        this.switchTab(e.target.dataset.tab);
      });
    });

    // Eventos de exportação
    this.elements.selectAllBtn.addEventListener("click", () => this.handleSelectAll());
    this.elements.deselectAllBtn.addEventListener("click", () => this.handleDeselectAll());
    this.elements.clearAllBtn.addEventListener("click", () => this.handleClearAll());
    this.elements.exportExcelBtn.addEventListener("click", () => this.handleExport('excel'));
    this.elements.exportCSVBtn.addEventListener("click", () => this.handleExport('csv'));
    this.elements.exportJSONBtn.addEventListener("click", () => this.handleExport('json'));

    // Botões de copiar (criados dinamicamente)
    document.addEventListener("click", (e) => {
      const copyButton = e.target.closest(".copy-btn");
      if (copyButton) this.handleCopy(copyButton);
    });

    // Consultas recentes
    this.elements.recentList.addEventListener("click", (e) => {
      const item = e.target.closest(".recent-item");
      if (!item) return;
      this.elements.cnpjInput.value = Formatters.CNPJ(item.dataset.cnpj);
      this.updateClearButton();
      Telemetry.trackEvent('recent_search_clicked');
      this.handleSearch();
    });

    // Focar no input ao carregar
    this.elements.cnpjInput.focus();
  }

  initializeTelemetry() {
    // Inicializar analytics
    Telemetry.trackPageView();
    
    // Configurar error handling global
    this.setupGlobalErrorHandling();
  }

  initializeRateLimitCheck() {
    if (RateLimitManager.isRateLimited()) {
      const remaining = RateLimitManager.getRemainingTime();
      this.showRateLimitError(remaining);
    }
  }

  setupGlobalErrorHandling() {
    window.addEventListener('error', (event) => {
      Telemetry.trackError(event.error, {
        type: 'global_error',
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno
      });
    });

    window.addEventListener('unhandledrejection', (event) => {
      Telemetry.trackError(new Error('Unhandled Promise Rejection'), {
        type: 'unhandled_rejection',
        reason: event.reason
      });
    });
  }

  // =============================================
  // SISTEMA DE RATE LIMIT E TIMER
  // =============================================

  showRateLimitError(waitTime) {
    const currentSearch = this.elements.cnpjInput.value;
    if (currentSearch && CNPJValidator.validate(currentSearch).isValid) {
      appState.setPendingSearch(CNPJValidator.validate(currentSearch).cleaned);
    }

    RateLimitManager.setRateLimit(waitTime);
    
    this.disableSearchButton(true);
    this.elements.cnpjInput.disabled = true;
    this.elements.errorMessage.classList.remove("hidden");
    
    this.updateTimerDisplay(waitTime);

    Telemetry.trackRateLimit(waitTime);
  }

  updateTimerDisplay(seconds) {
    if (seconds <= 0) {
      this.elements.errorMessage.classList.add("hidden");
      this.disableSearchButton(false);
      this.elements.cnpjInput.disabled = false;
      return;
    }

    const timeString = Formatters.time(seconds);
    this.elements.errorMessage.innerHTML = `
      <div class="rate-limit-message">
        <div class="rate-limit-icon">⏰</div>
        <div class="rate-limit-content">
          <strong>Limite de consultas excedido</strong>
          <p>Nova consulta automática em: <span class="timer">${timeString}</span></p>
          <small>Você pode continuar navegando, a pesquisa será realizada automaticamente</small>
        </div>
      </div>
    `;
  }

  handleAutoRetry() {
    const pendingSearch = appState.pendingSearch;
    
    if (pendingSearch && CONFIG.AUTO_RETRY_ENABLED) {
      console.log("🔄 Executando retry automático...");
      
      this.elements.cnpjInput.value = Formatters.CNPJ(pendingSearch);
      this.handleSearch();
      
      appState.clearPendingSearch();
      
      Telemetry.trackAutoRetry();
    }
  }

  // =============================================
  // MANIPULAÇÃO DE EXPORTAÇÃO
  // =============================================

  loadExportHistory() {
    const history = SearchHistoryManager.getHistoryList();
    this.updateExportUI(history);
  }

  updateExportUI(history) {
    const hasHistory = history.length > 0;
    
    this.elements.exportStats.textContent = `${history.length} pesquisa(s) salva(s)`;
    
    const selectedCount = appState.exportSelections.size;
    if (selectedCount > 0) {
      this.elements.selectionStats.textContent = `${selectedCount} selecionada(s)`;
      this.elements.selectionStats.classList.remove('hidden');
    } else {
      this.elements.selectionStats.classList.add('hidden');
    }

    const hasSelections = selectedCount > 0;
    this.elements.exportExcelBtn.disabled = !hasSelections;
    this.elements.exportCSVBtn.disabled = !hasSelections;
    this.elements.exportJSONBtn.disabled = !hasSelections;
    this.elements.clearAllBtn.disabled = !hasHistory;

    if (!hasHistory) {
      this.elements.exportList.innerHTML = `
        <div class="empty-state">
          <div class="icon">📋</div>
          <h3>Nenhuma pesquisa salva</h3>
          <p>As pesquisas que você fizer aparecerão aqui automaticamente</p>
        </div>
      `;
      return;
    }

    const historyHTML = history.map(item => {
      const isSelected = appState.exportSelections.has(item.cnpj);
      const formattedCNPJ = Formatters.CNPJ(item.cnpj);
      const companyName = item.companyName || 'Nome não disponível';
      
      return `
        <div class="export-item" data-cnpj="${item.cnpj}">
          <label class="export-checkbox">
            <input 
              type="checkbox" 
              ${isSelected ? 'checked' : ''}
              onchange="uiManager.handleExportSelection('${item.cnpj}')"
            />
            <span class="checkmark"></span>
          </label>
          <div class="export-info">
            <div class="export-company">${this.escapeHtml(companyName)}</div>
            <div class="export-cnpj">${formattedCNPJ}</div>
            <div class="export-date">Consultado em: ${Formatters.dateTime(item.timestamp)}</div>
          </div>
        </div>
      `;
    }).join('');

    this.elements.exportList.innerHTML = historyHTML;
  }

  handleExportSelection(cnpj) {
    appState.toggleExportSelection(cnpj);
    this.loadExportHistory();
  }

  handleSelectAll() {
    const history = SearchHistoryManager.getHistoryList();
    appState.selectAllExport(history);
    this.loadExportHistory();
    Telemetry.trackEvent('export_select_all', { count: history.length });
  }

  handleDeselectAll() {
    appState.deselectAllExport();
    this.loadExportHistory();
    Telemetry.trackEvent('export_deselect_all');
  }

  handleClearAll() {
    if (confirm('Tem certeza que deseja limpar todas as pesquisas salvas?')) {
      SearchHistoryManager.clearHistory();
      appState.deselectAllExport();
      this.loadExportHistory();
      this.renderRecentSearches();
      this.showNotification('Todas as pesquisas foram removidas', 'success');
      Telemetry.trackEvent('history_cleared');
    }
  }

  async handleExport(format) {
    const startTime = Date.now();
    const history = SearchHistoryManager.getHistoryList();
    const selections = appState.getSelectedExports(history);
    
    if (selections.length === 0) {
      this.showNotification('Selecione pelo menos uma pesquisa para exportar', 'error');
      return;
    }

    try {
      if (format === 'excel') {
        try {
          await this.loadSheetJS();
        } catch (error) {
          console.error('Erro ao carregar SheetJS:', error);
          this.showNotification('Erro ao carregar biblioteca Excel. Usando CSV como alternativa.', 'warning');
          format = 'csv';
        }
      }

      let content, filename, mimeType;

      switch (format) {
        case 'excel':
          if (typeof XLSX === 'undefined') {
            throw new Error('Biblioteca Excel não disponível');
          }
          
          const excelBuffer = await ExportManager.exportToExcel(selections);
          if (excelBuffer && (excelBuffer instanceof ArrayBuffer || excelBuffer instanceof Uint8Array)) {
            filename = `cnpj_pesquisas_${new Date().toISOString().split('T')[0]}.xlsx`;
            ExportManager.downloadExcelFile(excelBuffer, filename);
            this.showNotification('Arquivo Excel baixado com sucesso!', 'success');
          } else {
            throw new Error('Falha ao gerar arquivo Excel');
          }
          break;
            
        case 'csv':
          content = ExportManager.exportToCSV(selections);
          filename = `cnpj_pesquisas_${new Date().toISOString().split('T')[0]}.csv`;
          mimeType = 'text/csv;charset=utf-8';
          ExportManager.downloadFile(content, filename, mimeType);
          this.showNotification('Arquivo CSV baixado com sucesso!', 'success');
          break;
            
        case 'json':
          content = ExportManager.exportToJSON(selections);
          filename = `cnpj_pesquisas_${new Date().toISOString().split('T')[0]}.json`;
          mimeType = 'application/json';
          ExportManager.downloadFile(content, filename, mimeType);
          this.showNotification('Arquivo JSON baixado com sucesso!', 'success');
          break;
      }
      
      const duration = Date.now() - startTime;
      Telemetry.trackExport(format, selections.length);
      
    } catch (error) {
      console.error('Erro na exportação:', error);
      Telemetry.trackError(error, { action: 'export', format: format });
      
      if (format === 'excel') {
        this.showNotification('Erro ao exportar Excel. Tentando CSV...', 'warning');
        setTimeout(() => this.handleExport('csv'), 1000);
      } else {
        this.showNotification(`Erro ao exportar arquivo ${format.toUpperCase()}`, 'error');
      }
    }
  }

  async loadSheetJS() {
    return new Promise((resolve, reject) => {
      if (typeof XLSX !== 'undefined') {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      script.onload = () => {
        console.log('✅ SheetJS carregado com sucesso');
        resolve();
      };
      script.onerror = () => {
        console.error('❌ Erro ao carregar SheetJS');
        reject(new Error('Falha ao carregar biblioteca Excel'));
      };
      document.head.appendChild(script);
    });
  }

  showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 12px 20px;
      background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
      color: white;
      border-radius: 8px;
      z-index: 1000;
      animation: slideIn 0.3s ease;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
      notification.remove();
    }, 3000);

    Telemetry.trackEvent('notification_shown', { type: type, message: message });
  }

  // =============================================
  // MÉTODOS DE PESQUISA E EXIBIÇÃO
  // =============================================

  handleInputFormat(e) {
    const input = e.target;
    const cursorPosition = input.selectionStart;
    const originalLength = input.value.length;
    
    const raw = CNPJValidator.clean(input.value).substring(0, 14);

    let value = raw.substring(0, 2);
    if (raw.length > 2) value += "." + raw.substring(2, 5);
    if (raw.length > 5) value += "." + raw.substring(5, 8);
    if (raw.length > 8) value += "/" + raw.substring(8, 12);
    if (raw.length > 12) value += "-" + raw.substring(12, 14);

    input.value = value;
    
    const newLength = input.value.length;
    const lengthDiff = newLength - originalLength;
    const newCursorPosition = Math.max(0, cursorPosition + lengthDiff);

    input.setSelectionRange(newCursorPosition, newCursorPosition);
  }

  async handleSearch() {
    if (RateLimitManager.isRateLimited()) {
      const remaining = RateLimitManager.getRemainingTime();
      this.showRateLimitError(remaining);
      return;
    }

    const cnpjValue = this.elements.cnpjInput.value;
    const startTime = Date.now();
    
    this.clearError();
    this.hideResult();

    const validation = CNPJValidator.validate(cnpjValue);
    
    if (!validation.isValid) {
      this.showError(validation.error);
      Telemetry.trackEvent('validation_error', { error: validation.error });
      return;
    }

    await this.searchCNPJ(validation.cleaned, startTime);
  }

  async searchCNPJ(cnpj, startTime) {
    this.showLoading();
    this.disableSearchButton(true);
    appState.setLoading(true);

    try {
      console.log("🔍 Iniciando consulta para CNPJ:", cnpj);
      
      const data = await ApiManager.fetchCNPJ(cnpj);
      console.log("✅ Dados recebidos com sucesso");

      SearchHistoryManager.saveToHistory(cnpj, data);
      this.renderRecentSearches();

      this.displayData(data);
      appState.setLastSearch(cnpj);
      appState.retryCount = 0;
      
      this.loadExportHistory();
      
      const duration = Date.now() - startTime;
      Telemetry.trackSearch(cnpj, true, duration);
      
    } catch (error) {
      console.error("💥 Erro na consulta:", error);
      
      const duration = Date.now() - startTime;
      Telemetry.trackSearch(cnpj, false, duration, error);
      
      if (error.message.startsWith('RATE_LIMIT:')) {
        const waitTime = parseInt(error.message.split(':')[1]);
        this.showRateLimitError(waitTime);
      } else if (this.isRetryable(error) && appState.retryCount < CONFIG.MAX_RETRIES) {
        appState.retryCount++;
        console.log(`🔄 Tentativa ${appState.retryCount} de ${CONFIG.MAX_RETRIES}`);
        
        await this.delay(CONFIG.RETRY_DELAY);
        return this.searchCNPJ(cnpj, startTime);
      } else {
        this.showError(this.getErrorMessage(error));
        appState.retryCount = 0;
      }
    } finally {
      this.hideLoading();
      this.renderRecentSearches();
      if (!RateLimitManager.isRateLimited()) {
        this.disableSearchButton(false);
      }
      appState.setLoading(false);
    }
  }

  // Só vale tentar de novo em falha de rede, timeout ou erro do servidor (5xx).
  // Erros 4xx (CNPJ inexistente, inválido) dariam o mesmo resultado e
  // consumiriam o limite de consultas à toa.
  isRetryable(error) {
    if (!error.status) return true;
    return error.status === 408 || error.status >= 500;
  }

  getErrorMessage(error) {
    const message = error.message || "Erro desconhecido";

    if (message.includes("Tempo limite") || error.status === 408) {
      return "A consulta demorou muito tempo. Tente novamente.";
    } else if (error.status === 404 || message.includes("404") || message.includes("não encontrada")) {
      return "Empresa não encontrada para o CNPJ informado.";
    } else if (message.includes("Failed to fetch")) {
      return "Erro de conexão. Verifique sua internet e tente novamente.";
    }
    
    return `Erro: ${message}`;
  }

  displayData(data) {
    if (!data || !data.taxId) {
      this.showError("Dados da empresa não encontrados ou inválidos");
      return;
    }

    console.log("📊 Exibindo dados:", data);

    this.displaySummary(data);
    this.displayCompleteData(data);
    this.displayPartners(data.company?.members);

    this.switchTab('completo');
    this.showResult();

    Telemetry.trackEvent('data_displayed', {
      has_partners: !!(data.company?.members && data.company.members.length > 0),
      has_activities: !!(data.sideActivities && data.sideActivities.length > 0)
    });
  }

  // =============================================
  // CARD DE RESUMO
  // =============================================

  createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = text;
    return element;
  }

  getStatusVariant(statusText) {
    const status = String(statusText || "").toUpperCase();
    if (status.includes("ATIVA")) return "success";
    if (status.includes("SUSPENSA")) return "warning";
    if (status.includes("BAIXADA") || status.includes("INAPTA") || status.includes("NULA")) return "error";
    return "neutral";
  }

  createBadge(text, variant = "neutral") {
    return this.createElement("span", `badge badge-${variant}`, text);
  }

  createCopyButton(value, label) {
    const button = this.createElement("button", "copy-btn");
    button.type = "button";
    button.dataset.copy = value;
    button.setAttribute("aria-label", `Copiar ${label}`);
    button.title = `Copiar ${label}`;
    button.innerHTML = `
      <svg class="copy-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>
      <svg class="check-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>
    `;
    return button;
  }

  async handleCopy(button) {
    const text = button.dataset.copy || "";
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.cssText = "position:fixed;opacity:0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }
      button.classList.add("copied");
      this.announceToScreenReader("Copiado");
      setTimeout(() => button.classList.remove("copied"), 1500);
      Telemetry.trackEvent('value_copied', { field: button.getAttribute("aria-label") });
    } catch (error) {
      this.showNotification("Não foi possível copiar", "error");
    }
  }

  displaySummary(data) {
    const card = this.elements.summaryCard;
    card.innerHTML = "";

    const main = this.createElement("div", "summary-main");

    const badges = this.createElement("div", "summary-badges");
    if (data.status?.text) {
      const variant = this.getStatusVariant(data.status.text);
      const badge = this.createBadge(data.status.text, variant);
      badge.prepend(this.createElement("span", "badge-dot"));
      badges.appendChild(badge);
    }
    badges.appendChild(this.createBadge(data.head ? "Matriz" : "Filial"));
    if (data.company?.simei?.optant) badges.appendChild(this.createBadge("MEI", "info"));
    else if (data.company?.simples?.optant) badges.appendChild(this.createBadge("Simples Nacional", "info"));
    if (data.company?.size?.text) badges.appendChild(this.createBadge(data.company.size.text));
    main.appendChild(badges);

    const nameRow = this.createElement("div", "summary-name-row");
    nameRow.appendChild(this.createElement("h2", "summary-name", data.company?.name || "Razão social não informada"));
    if (data.company?.name) nameRow.appendChild(this.createCopyButton(data.company.name, "razão social"));
    main.appendChild(nameRow);

    if (data.alias) {
      main.appendChild(this.createElement("p", "summary-alias", data.alias));
    }

    const cnpjRow = this.createElement("div", "summary-cnpj");
    const formattedCNPJ = Formatters.CNPJ(data.taxId);
    cnpjRow.appendChild(this.createElement("span", null, formattedCNPJ));
    cnpjRow.appendChild(this.createCopyButton(formattedCNPJ, "CNPJ"));
    main.appendChild(cnpjRow);

    card.appendChild(main);

    const facts = this.createElement("dl", "summary-facts");
    const addFact = (label, value, wide = false) => {
      if (!value) return;
      const fact = this.createElement("div", wide ? "summary-fact summary-fact-wide" : "summary-fact");
      fact.appendChild(this.createElement("dt", null, label));
      fact.appendChild(this.createElement("dd", null, value));
      facts.appendChild(fact);
    };

    const years = Formatters.yearsSince(data.founded);
    addFact("Abertura", data.founded
      ? `${Formatters.date(data.founded)}${years !== null ? ` · ${years} ${years === 1 ? "ano" : "anos"}` : ""}`
      : null);
    addFact("Localização", [data.address?.city, data.address?.state].filter(Boolean).join("/"));
    addFact("Atividade principal", data.mainActivity
      ? `${Formatters.cnae(data.mainActivity.id)} · ${data.mainActivity.text}`
      : null, true);
    addFact("Capital social", data.company?.equity
      ? `R$ ${Formatters.currency(data.company.equity)}`
      : null, true);

    if (facts.children.length > 0) card.appendChild(facts);
  }

  // =============================================
  // CONSULTAS RECENTES
  // =============================================

  renderRecentSearches() {
    const list = this.elements.recentList;
    const history = SearchHistoryManager.getHistoryList()
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 6);

    list.innerHTML = "";
    history.forEach(item => {
      const button = this.createElement("button", "recent-item");
      button.type = "button";
      button.dataset.cnpj = item.cnpj;
      button.appendChild(this.createElement("span", "recent-name", item.companyName || "Nome não disponível"));
      const meta = this.createElement("span", "recent-meta");
      meta.appendChild(this.createElement("span", null, Formatters.CNPJ(item.cnpj)));
      meta.appendChild(this.createElement("span", "recent-date", Formatters.relativeDate(item.timestamp)));
      button.appendChild(meta);
      list.appendChild(button);
    });

    const isBusy = !this.elements.result.classList.contains("hidden") ||
                   !this.elements.loading.classList.contains("hidden");
    this.elements.recentSearches.classList.toggle("hidden", history.length === 0 || isBusy);
  }

  // =============================================
  // SÓCIOS
  // =============================================

  displayPartners(members) {
    const INITIAL_COUNT = 6;
    this.elements.partnersList.innerHTML = "";

    if (!members || members.length === 0) {
      this.elements.partnersCard.classList.add("hidden");
      return;
    }

    const sortedMembers = [...members].sort((a, b) => {
      const dateA = Formatters.parseDate(a.since) || new Date(0);
      const dateB = Formatters.parseDate(b.since) || new Date(0);
      return dateB - dateA;
    });

    sortedMembers.forEach((member, index) => {
      const partnerItem = this.createPartnerElement(member);
      if (index >= INITIAL_COUNT) partnerItem.classList.add("hidden");
      this.elements.partnersList.appendChild(partnerItem);
    });

    if (sortedMembers.length > INITIAL_COUNT) {
      const showAll = this.createElement("button", "partner-more",
        `Mostrar todos os ${sortedMembers.length} sócios`);
      showAll.type = "button";
      showAll.addEventListener("click", () => {
        this.elements.partnersList
          .querySelectorAll(".partner-item.hidden")
          .forEach(item => item.classList.remove("hidden"));
        showAll.remove();
      });
      this.elements.partnersList.appendChild(showAll);
    }

    this.elements.partnersCard.classList.remove("hidden");
  }

  createPartnerElement(member) {
    const partnerItem = this.createElement("div", "partner-item");
    partnerItem.setAttribute("role", "listitem");

    partnerItem.appendChild(this.createElement("div", "partner-name", member.person?.name || "Nome não informado"));
    partnerItem.appendChild(this.createElement("div", "partner-role", member.role?.text || "Cargo não informado"));

    const details = [];
    if (member.since) details.push(`Desde ${Formatters.date(member.since)}`);
    if (member.person?.age) details.push(member.person.age);
    if (details.length > 0) {
      partnerItem.appendChild(this.createElement("div", "partner-qualification", details.join(" · ")));
    }

    return partnerItem;
  }

  // =============================================
  // DADOS COMPLETOS
  // =============================================

  displayCompleteData(data) {
    this.elements.completeData.innerHTML = "";

    if (!data) {
      this.showEmptyState(this.elements.completeData, "Nenhum dado completo disponível");
      return;
    }

    const sections = [
      this.createBasicInfoSection(data),
      this.createCompanyInfoSection(data),
      this.createAddressSection(data),
      this.createContactSection(data),
      this.createActivitiesSection(data),
      this.createRegistrationsSection(data)
    ];

    sections.forEach(section => {
      if (section) {
        this.elements.completeData.appendChild(section);
      }
    });

    if (this.elements.completeData.children.length === 0) {
      this.showEmptyState(this.elements.completeData, "Nenhum dado completo disponível");
    }
  }

  createBasicInfoSection(data) {
    const fields = [
      { label: "CNPJ", value: Formatters.CNPJ(data.taxId), copy: true },
      { label: "Razão Social", value: data.company?.name, copy: true },
      { label: "Nome Fantasia", value: data.alias, copy: true },
      { label: "Data de Abertura", value: Formatters.date(data.founded) },
      { label: "Situação Cadastral", value: data.status?.text },
      { label: "Data da Situação", value: Formatters.date(data.statusDate) },
      { label: "Matriz/Filial", value: data.head ? "Matriz" : "Filial" },
      { label: "Última Atualização", value: Formatters.date(data.updated) }
    ];

    return this.createSection("Informações Básicas", fields);
  }

  createCompanyInfoSection(data) {
    const fields = [];

    if (data.company?.nature) {
      fields.push({
        label: "Natureza Jurídica",
        value: `${data.company.nature.id} - ${data.company.nature.text}`
      });
    }

    if (data.company?.size) {
      fields.push({
        label: "Porte da Empresa",
        value: `${data.company.size.text} (${data.company.size.acronym})`
      });
    }

    if (data.company?.equity) {
      fields.push({
        label: "Capital Social",
        value: `R$ ${Formatters.currency(data.company.equity)}`
      });
    }

    const regimes = [];
    if (data.company?.simples?.optant) {
      regimes.push(`Simples Nacional desde ${Formatters.date(data.company.simples.since)}`);
    }
    if (data.company?.simei?.optant) {
      regimes.push(`MEI desde ${Formatters.date(data.company.simei.since)}`);
    }
    fields.push({
      label: "Regimes Especiais",
      value: regimes.length > 0 ? regimes : "Não optante pelo Simples/MEI"
    });

    return this.createSection("Informações da Empresa", fields);
  }

  createAddressSection(data) {
    if (!data.address) return null;

    const address = data.address;
    const fullAddress = [
      [address.street, address.number].filter(Boolean).join(", "),
      address.details,
      address.district,
      [address.city, address.state].filter(Boolean).join("/"),
      address.zip ? `CEP ${Formatters.CEP(address.zip)}` : null
    ].filter(Boolean).join(" - ");

    const fields = [
      { label: "Endereço Completo", value: fullAddress, copy: true },
      { label: "Logradouro", value: address.street },
      { label: "Número", value: address.number },
      { label: "Complemento", value: address.details },
      { label: "Bairro", value: address.district },
      { label: "Cidade", value: address.city },
      { label: "Estado", value: address.state },
      { label: "CEP", value: Formatters.CEP(address.zip), copy: true },
      { label: "País", value: Formatters.country(address.country) },
      { label: "Código Município (IBGE)", value: address.municipality, copy: true }
    ].filter(field => field.value);

    return fields.length > 0 ? this.createSection("Endereço", fields) : null;
  }

  createContactSection(data) {
    const fields = [];

    if (data.phones && data.phones.length > 0) {
      const phones = data.phones
        .filter(phone => phone.number)
        .map(phone => {
          const number = phone.area ? Formatters.phone(`${phone.area}${phone.number}`) : phone.number;
          return { number, text: `${number} (${phone.type === "MOBILE" ? "Celular" : "Fixo"})` };
        });

      if (phones.length > 0) {
        fields.push({
          label: "Telefones",
          value: phones.map(phone => phone.text),
          copy: true,
          copyValue: phones.map(phone => phone.number).join("\n")
        });
      }
    }

    if (data.emails && data.emails.length > 0) {
      const emails = data.emails.map(email => email.address).filter(Boolean);
      if (emails.length > 0) {
        fields.push({
          label: "E-mails",
          value: emails.map(email => email.toLowerCase()),
          copy: true,
          copyValue: emails.map(email => email.toLowerCase()).join("\n")
        });
      }
    }

    return fields.length > 0 ? this.createSection("Contatos", fields) : null;
  }

  createActivitiesSection(data) {
    const fields = [];

    if (data.mainActivity) {
      fields.push({
        label: "CNAE Principal",
        value: `${Formatters.cnae(data.mainActivity.id)} - ${data.mainActivity.text}`
      });
    }

    if (data.sideActivities && data.sideActivities.length > 0) {
      const secondaryActivities = data.sideActivities.map(
        activity => `${Formatters.cnae(activity.id)} - ${activity.text}`
      );
      fields.push({ label: `CNAEs Secundários (${secondaryActivities.length})`, value: secondaryActivities });
    }

    const section = fields.length > 0 ? this.createSection("Atividades Econômicas", fields) : null;
    if (section) section.classList.add("info-section-wide");
    return section;
  }

  createRegistrationsSection(data) {
    const fields = [];

    if (data.registrations && data.registrations.length > 0) {
      const ies = data.registrations.map(reg => {
        const status = reg.enabled ? "✅" : "❌";
        return `${status} ${reg.number} - ${reg.state} - ${reg.status?.text}`;
      });
      fields.push({ label: "Inscrições Estaduais", value: ies });
    }

    if (data.suframa && data.suframa.length > 0) {
      const suframaItems = data.suframa.map(suf => {
        const status = suf.approved ? "✅ Aprovado" : "❌ Pendente";
        return `Nº: ${suf.number} - ${status} - Desde: ${Formatters.date(suf.since)}`;
      });
      fields.push({ label: "Registro SUFRAMA", value: suframaItems });

      if (data.suframa[0].incentives && data.suframa[0].incentives.length > 0) {
        const incentivos = data.suframa[0].incentives.map(
          inc => `${inc.tribute}: ${inc.benefit} - ${inc.purpose}`
        );
        fields.push({ label: "Incentivos Fiscais SUFRAMA", value: incentivos });
      }
    }

    const section = fields.length > 0 ? this.createSection("Registros e Inscrições", fields) : null;
    if (section) section.classList.add("info-section-wide");
    return section;
  }

  createSection(title, fields) {
    const validFields = fields.filter(field =>
      field.value !== undefined &&
      field.value !== null &&
      field.value !== "" &&
      field.value !== "Não informado" &&
      !(Array.isArray(field.value) && field.value.length === 0)
    );

    if (validFields.length === 0) return null;

    const section = document.createElement("div");
    section.className = "info-section";

    const sectionTitle = document.createElement("h3");
    sectionTitle.className = "section-title";
    sectionTitle.textContent = title;
    section.appendChild(sectionTitle);

    validFields.forEach(field => {
      const item = this.createInfoItem(field);
      if (item) section.appendChild(item);
    });

    return section;
  }

  createInfoItem({ label, value, copy = false, copyValue }) {
    const item = document.createElement("div");
    item.className = "info-item";

    const labelSpan = document.createElement("span");
    labelSpan.className = "label";
    labelSpan.textContent = label;

    const valueSpan = document.createElement("span");
    valueSpan.className = "value";

    if (Array.isArray(value)) {
      const list = document.createElement("ul");
      list.className = "value-list";
      value.forEach(text => list.appendChild(this.createElement("li", null, text)));
      valueSpan.appendChild(list);
    } else {
      valueSpan.textContent = String(value);
    }

    item.appendChild(labelSpan);
    item.appendChild(valueSpan);

    if (copy) {
      item.classList.add("has-copy");
      const text = copyValue ?? (Array.isArray(value) ? value.join("\n") : String(value));
      item.appendChild(this.createCopyButton(text, label.toLowerCase()));
    }

    return item;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  showEmptyState(container, message) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">📄</div>
        <h3>Sem dados</h3>
        <p>${message}</p>
      </div>
    `;
  }

  setElementText(element, text) {
    element.textContent = text || "Não informado";
  }

  showLoading() {
    this.elements.recentSearches.classList.add("hidden");
    this.elements.loading.classList.remove("hidden");
    this.elements.loading.setAttribute("aria-busy", "true");
  }

  hideLoading() {
    this.elements.loading.classList.add("hidden");
    this.elements.loading.setAttribute("aria-busy", "false");
  }

  showResult() {
    this.elements.result.classList.remove("hidden");
    this.elements.result.setAttribute("aria-live", "polite");
    
    const firstTab = document.querySelector('.tab-button');
    if (firstTab) firstTab.focus();
    this.updateClearButton();
  }

  hideResult() {
    this.elements.result.classList.add("hidden");
    this.updateClearButton();
  }

  showError(message) {
    this.elements.errorMessage.textContent = message;
    this.elements.errorMessage.classList.remove("hidden");
    this.elements.errorMessage.focus();
    this.updateClearButton();

    Telemetry.trackEvent('error_displayed', { message: message });
  }

  clearError() {
    this.elements.errorMessage.textContent = "";
    this.elements.errorMessage.classList.add("hidden");
    this.updateClearButton();
  }

  // O "×" aparece quando há algo para limpar: texto, resultado ou erro
  updateClearButton() {
    const hasContent = this.elements.cnpjInput.value.trim() !== "" ||
                       !this.elements.result.classList.contains("hidden") ||
                       !this.elements.errorMessage.classList.contains("hidden");
    this.elements.clearBtn.classList.toggle("hidden", !hasContent);
  }

  // Volta à tela inicial: limpa campo, resultado e erro e mostra as consultas recentes
  clearSearch() {
    if (appState.isLoading) return;

    this.elements.cnpjInput.value = "";
    this.hideResult();
    // Durante o bloqueio por limite de consultas, o aviso com o contador permanece
    if (!RateLimitManager.isRateLimited()) {
      this.clearError();
    }
    this.elements.summaryCard.innerHTML = "";
    appState.setLastSearch(null);
    appState.clearPendingSearch();

    this.renderRecentSearches();
    this.updateClearButton();
    if (!this.elements.cnpjInput.disabled) this.elements.cnpjInput.focus();

    Telemetry.trackEvent('search_cleared');
  }

  disableSearchButton(disabled) {
    this.elements.searchBtn.disabled = disabled;
    this.elements.cnpjInput.disabled = disabled;
    this.elements.clearBtn.disabled = disabled;
    const buttonText = this.elements.searchBtn.querySelector(".button-text");
    const buttonLoading = this.elements.searchBtn.querySelector(".button-loading");

    if (disabled) {
      buttonText.classList.add("hidden");
      buttonLoading.classList.remove("hidden");
      this.elements.searchBtn.setAttribute("aria-label", "Consultando...");
    } else {
      buttonText.classList.remove("hidden");
      buttonLoading.classList.add("hidden");
      this.elements.searchBtn.setAttribute("aria-label", "Pesquisar CNPJ");
    }
  }

  switchTab(tabName) {
    document.querySelectorAll(".tab-button").forEach(button => {
      button.classList.remove("active");
      button.setAttribute("aria-selected", "false");
    });
    
    const activeButton = document.querySelector(`[data-tab="${tabName}"]`);
    activeButton.classList.add("active");
    activeButton.setAttribute("aria-selected", "true");

    document.querySelectorAll(".tab-pane").forEach(pane => {
      pane.classList.remove("active");
    });
    
    const activePane = document.getElementById(`tab-${tabName}`);
    activePane.classList.add("active");

    if (tabName === 'exportar') {
      this.loadExportHistory();
    }

    Telemetry.trackEvent('tab_switched', { tab: tabName });
  }

  toggleTheme() {
    const body = document.body;
    const isDarkMode = body.classList.contains("dark-mode");

    // Ícone sol/lua é alternado via CSS conforme a classe dark-mode
    if (isDarkMode) {
      body.classList.remove("dark-mode");
      appState.setTheme("light");
      Telemetry.trackEvent('theme_changed', { theme: 'light' });
    } else {
      body.classList.add("dark-mode");
      appState.setTheme("dark");
      Telemetry.trackEvent('theme_changed', { theme: 'dark' });
    }

    this.announceToScreenReader(`Modo ${isDarkMode ? 'claro' : 'escuro'} ativado`);
  }

  announceToScreenReader(message) {
    const announcer = document.getElementById('aria-announcer') || this.createAriaAnnouncer();
    announcer.textContent = message;
  }

  createAriaAnnouncer() {
    const announcer = document.createElement('div');
    announcer.id = 'aria-announcer';
    announcer.className = 'sr-only';
    announcer.setAttribute('aria-live', 'polite');
    announcer.setAttribute('aria-atomic', 'true');
    document.body.appendChild(announcer);
    return announcer;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// =============================================
// MONITORAMENTO E TELEMETRIA
// =============================================
class Telemetry {
  static isDevelopment() {
    return CONFIG.ENV === 'development';
  }

  static trackEvent(eventName, properties = {}) {
    if (typeof gtag !== 'undefined') {
      gtag('event', eventName, properties);
    }
    
    if (this.isDevelopment()) {
      console.log('📊 Evento:', eventName, properties);
    }

    this.sendToAnalytics(eventName, properties);
  }

  static sendToAnalytics(eventName, properties) {
    const analyticsData = {
      event: eventName,
      properties: properties,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href
    };

    if (this.isDevelopment()) {
      const analyticsHistory = JSON.parse(localStorage.getItem('analytics_history') || '[]');
      analyticsHistory.push(analyticsData);
      localStorage.setItem('analytics_history', JSON.stringify(analyticsHistory.slice(-50)));
    }
  }

  static trackSearch(cnpj, success, duration, error = null) {
    this.trackEvent('cnpj_search', {
      cnpj_length: cnpj.length,
      success: success,
      duration: duration,
      error_type: error?.name || null,
      environment: CONFIG.ENV
    });
  }

  static trackExport(format, itemCount) {
    this.trackEvent('export_data', {
      format: format,
      item_count: itemCount,
      environment: CONFIG.ENV
    });
  }

  static trackError(error, context = {}) {
    this.trackEvent('error_occurred', {
      error_name: error.name,
      error_message: error.message,
      environment: CONFIG.ENV,
      ...context
    });
    
    if (typeof window.Sentry !== 'undefined') {
      window.Sentry.captureException(error, { extra: context });
    }

    if (this.isDevelopment()) {
      console.error('❌ Erro:', error, context);
    }
  }

  static trackPageView() {
    this.trackEvent('page_view', {
      page_title: document.title,
      page_location: window.location.href,
      environment: CONFIG.ENV
    });
  }

  static trackRateLimit(waitTime) {
    this.trackEvent('rate_limit_triggered', {
      wait_time: waitTime,
      environment: CONFIG.ENV
    });
  }

  static trackAutoRetry() {
    this.trackEvent('auto_retry_executed', {
      environment: CONFIG.ENV
    });
  }
}

// =============================================
// INICIALIZAÇÃO DA APLICAÇÃO
// =============================================
let appState;
let uiManager;

function initializeApp() {
  console.log("🚀 Inicializando CNPJ Finder...");
  
  appState = new AppState();
  uiManager = new UIManager();
  
  loadSavedTheme();
  setupServiceWorker();

  const yearElement = document.getElementById("currentYear");
  if (yearElement) yearElement.textContent = new Date().getFullYear();
  
  console.log("✅ Aplicação inicializada com sucesso - Versão:", CONFIG.APP_VERSION);
}

function loadSavedTheme() {
  const savedTheme = localStorage.getItem("theme");
  document.body.classList.toggle("dark-mode", savedTheme !== "light");
}

function setupServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then(registration => {
          console.log('✅ Service Worker registrado:', registration);
          
          // Verificar atualizações do Service Worker
          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            console.log('🔄 Nova versão do Service Worker encontrada');
            
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('✅ Nova versão do Service Worker instalada');
                // Opcional: mostrar notificação para recarregar
                if (confirm('Uma nova versão do app está disponível. Recarregar agora?')) {
                  window.location.reload();
                }
              }
            });
          });
        })
        .catch(error => {
          console.log('❌ Falha no Service Worker:', error);
        });
    });
  }
}

// Inicializar quando o DOM estiver pronto
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}

// Exportar para testes
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CNPJValidator, Formatters, ApiManager, SearchHistoryManager, ExportManager };
}