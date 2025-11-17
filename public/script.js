// Configurações
const API_BASE_URL = "/api/cnpj";

// Elementos DOM
const cnpjInput = document.getElementById("cnpjInput");
const searchBtn = document.getElementById("searchBtn");
const errorMessage = document.getElementById("errorMessage");
const loading = document.getElementById("loading");
const result = document.getElementById("result");
const partnersCard = document.getElementById("partnersCard");
const partnersList = document.getElementById("partnersList");
const themeToggle = document.getElementById("themeToggle");
const completeData = document.getElementById("completeData");

// Elementos para exibir os dados principais
const companyName = document.getElementById("companyName");
const tradeName = document.getElementById("tradeName");
const cnpj = document.getElementById("cnpj");
const ie = document.getElementById("ie");
const status = document.getElementById("status");
const address = document.getElementById("address");
const cnae = document.getElementById("cnae");
const phones = document.getElementById("phones");
const email = document.getElementById("email");

// Event Listeners
document.addEventListener("DOMContentLoaded", () => {
  searchBtn.addEventListener("click", handleSearch);
  cnpjInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  });

  // Permitir apenas números no input
  cnpjInput.addEventListener("input", (e) => {
    e.target.value = e.target.value.replace(/\D/g, "");
  });

  // Toggle de tema
  themeToggle.addEventListener("click", toggleTheme);

  // Tabs
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", (e) => {
      switchTab(e.target.dataset.tab);
    });
  });

  // Focar no input ao carregar a página
  cnpjInput.focus();
});

// Função para alternar entre tabs
function switchTab(tabName) {
  // Atualizar botões das tabs
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.classList.remove("active");
  });
  document.querySelector(`[data-tab="${tabName}"]`).classList.add("active");

  // Atualizar conteúdo das tabs
  document.querySelectorAll(".tab-pane").forEach((pane) => {
    pane.classList.remove("active");
  });
  document.getElementById(`tab-${tabName}`).classList.add("active");
}

// Função para alternar tema
function toggleTheme() {
  const body = document.body;
  const isDarkMode = body.classList.contains("dark-mode");

  if (isDarkMode) {
    body.classList.remove("dark-mode");
    themeToggle.querySelector(".theme-icon").textContent = "🌙";
  } else {
    body.classList.add("dark-mode");
    themeToggle.querySelector(".theme-icon").textContent = "☀️";
  }

  // Salvar preferência no localStorage
  localStorage.setItem("theme", isDarkMode ? "light" : "dark");
}

// Função para validar o CNPJ
function validateCNPJ(cnpj) {
  cnpj = cnpj.replace(/\D/g, "");

  if (cnpj.length !== 14) {
    return false;
  }

  // Elimina CNPJs com valores inválidos conhecidos
  if (/^(\d)\1+$/.test(cnpj)) {
    return false;
  }

  // Validação dos dígitos verificadores
  let tamanho = cnpj.length - 2;
  let numeros = cnpj.substring(0, tamanho);
  let digitos = cnpj.substring(tamanho);
  let soma = 0;
  let pos = tamanho - 7;

  for (let i = tamanho; i >= 1; i--) {
    soma += numeros.charAt(tamanho - i) * pos--;
    if (pos < 2) {
      pos = 9;
    }
  }

  let resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11);
  if (resultado !== parseInt(digitos.charAt(0))) {
    return false;
  }

  tamanho = tamanho + 1;
  numeros = cnpj.substring(0, tamanho);
  soma = 0;
  pos = tamanho - 7;

  for (let i = tamanho; i >= 1; i--) {
    soma += numeros.charAt(tamanho - i) * pos--;
    if (pos < 2) {
      pos = 9;
    }
  }

  resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11);
  if (resultado !== parseInt(digitos.charAt(1))) {
    return false;
  }

  return true;
}

// Função para lidar com a pesquisa
function handleSearch() {
  const cnpjValue = cnpjInput.value.replace(/\D/g, "");

  // Limpar mensagens de erro e resultados anteriores
  clearError();
  hideResult();

  // Validar CNPJ
  if (!cnpjValue) {
    showError("Por favor, digite um CNPJ");
    return;
  }

  if (cnpjValue.length !== 14) {
    showError("CNPJ deve conter 14 dígitos");
    return;
  }

  if (!validateCNPJ(cnpjValue)) {
    showError("CNPJ inválido");
    return;
  }

  // Fazer a consulta
  searchCNPJ(cnpjValue);
}

// Função para fazer a requisição à API
async function searchCNPJ(cnpj) {
  showLoading();
  disableSearchButton(true);

  try {
    console.log("🔍 Fazendo requisição para:", `${API_BASE_URL}?cnpj=${cnpj}`);

    const response = await fetch(`${API_BASE_URL}?cnpj=${cnpj}`);

    console.log("📊 Status da resposta:", response.status);
    console.log("✅ Response OK:", response.ok);

    // Primeiro, ler a resposta como texto
    const responseText = await response.text();
    console.log("📄 Resposta (texto):", responseText.substring(0, 200));

    if (!response.ok) {
      // Se não é OK, tentar parsear como JSON para obter mensagem de erro
      let errorMessage = `Erro ${response.status}`;

      try {
        const errorData = JSON.parse(responseText);
        errorMessage = errorData.message || errorMessage;
      } catch (e) {
        // Se não é JSON, usar o texto direto
        if (
          responseText.includes("<!DOCTYPE") ||
          responseText.includes("<html")
        ) {
          errorMessage = "Servidor retornou página HTML inesperada";
        } else if (responseText.trim()) {
          errorMessage = responseText;
        }
      }

      throw new Error(errorMessage);
    }

    // Se response.ok é true, tentar parsear como JSON
    let result;
    try {
      result = JSON.parse(responseText);
    } catch (e) {
      console.error("❌ Erro ao parsear JSON:", e);
      throw new Error("Resposta da API inválida (não é JSON)");
    }

    if (result.error) {
      throw new Error(result.message);
    }

    console.log("✅ Dados recebidos com sucesso");
    console.log("📦 Estrutura completa:", result.data);
    displayData(result.data);
  } catch (error) {
    console.error("💥 Erro na consulta:", error);
    showError(`Erro: ${error.message}`);
  } finally {
    hideLoading();
    disableSearchButton(false);
  }
}

// Função para exibir os dados no HTML
function displayData(data) {
  // Verificar se os dados básicos existem
  if (!data || !data.taxId) {
    showError("Dados da empresa não encontrados ou inválidos");
    return;
  }

  console.log("📦 Estrutura completa dos dados:", data);

  // Dados básicos da empresa (Aba Principal)
  companyName.textContent = data.company?.name || "Não informado";
  tradeName.textContent = data.alias || data.company?.name || "Não informado";
  cnpj.textContent = formatCNPJString(data.taxId) || "Não informado";

  // Inscrição Estadual - Buscar no array registrations
  const iePrincipal = getPrincipalIE(data.registrations);
  ie.textContent = iePrincipal || "Não informado";

  // Situação cadastral com cor
  const statusText = data.status?.text || "Não informado";
  status.textContent = statusText;
  status.className =
    "value " +
    (statusText.toLowerCase().includes("ativa") ? "status-active" : "");

  // Endereço
  const addressParts = [
    data.address?.street,
    data.address?.number,
    data.address?.details,
    data.address?.district,
    data.address?.city,
    data.address?.state,
  ]
    .filter((part) => part)
    .join(", ");

  const zipCode = data.address?.zip
    ? ` - CEP: ${formatCEP(data.address.zip)}`
    : "";
  address.textContent = addressParts + zipCode || "Não informado";

  // CNAE Principal
  cnae.textContent = data.mainActivity?.text || "Não informado";

  // Telefones
  const phoneNumbers =
    data.phones
      ?.map((phone) => {
        if (phone.area && phone.number) {
          return formatPhone(`${phone.area}${phone.number}`);
        }
        return phone.number;
      })
      .join(", ") || "Não informado";
  phones.textContent = phoneNumbers;

  // E-mail
  const primaryEmail =
    data.emails?.find((email) => email.ownership === "CORPORATE") ||
    data.emails?.[0];
  email.textContent = primaryEmail?.address || "Não informado";

  // Sócios e Administradores
  displayPartners(data.company?.members);

  // Dados completos (Aba Completa)
  displayCompleteData(data);

  // Exibir resultados
  showResult();
}

// Função para obter a Inscrição Estadual principal
function getPrincipalIE(registrations) {
  if (!registrations || !Array.isArray(registrations)) return null;

  // Buscar IE Normal primeiro
  const ieNormal = registrations.find((reg) => reg.type?.id === 1);
  if (ieNormal) return `${ieNormal.number} (${ieNormal.state})`;

  // Se não encontrar, retornar a primeira
  const primeira = registrations[0];
  if (primeira) return `${primeira.number} (${primeira.state})`;

  return null;
}

// Função para exibir dados completos
function displayCompleteData(data) {
  completeData.innerHTML = "";

  if (!data) return;

  // Função auxiliar para criar itens de informação
  const createInfoItem = (label, value) => {
    if (
      value === undefined ||
      value === null ||
      value === "" ||
      value === "Não informado"
    )
      return null;

    const item = document.createElement("div");
    item.className = "info-item";

    const labelSpan = document.createElement("span");
    labelSpan.className = "label";
    labelSpan.textContent = label;

    const valueSpan = document.createElement("span");
    valueSpan.className = "value";

    // Se o valor for um array, formatar como lista
    if (Array.isArray(value)) {
      if (value.length === 0) return null;
      valueSpan.innerHTML = value.map((item) => `• ${item}`).join("<br>");
    } else {
      valueSpan.textContent = String(value);
    }

    item.appendChild(labelSpan);
    item.appendChild(valueSpan);
    return item;
  };

  // Dados básicos
  const basicFields = [
    { label: "CNPJ", value: formatCNPJString(data.taxId) },
    { label: "Razão Social", value: data.company?.name },
    { label: "Nome Fantasia", value: data.alias },
    { label: "Data de Abertura", value: formatDate(data.founded) },
    {
      label: "Data da Última Atualização",
      value: formatDateTime(data.updated),
    },
    { label: "Situação Cadastral", value: data.status?.text },
    { label: "Data da Situação", value: formatDate(data.statusDate) },
    { label: "Matriz/Filial", value: data.head ? "Matriz" : "Filial" },
  ];

  basicFields.forEach((field) => {
    const item = createInfoItem(field.label, field.value);
    if (item) completeData.appendChild(item);
  });

  // Natureza Jurídica e Porte
  if (data.company?.nature) {
    const item = createInfoItem(
      "Natureza Jurídica",
      `${data.company.nature.id} - ${data.company.nature.text}`
    );
    if (item) completeData.appendChild(item);
  }

  if (data.company?.size) {
    const item = createInfoItem(
      "Porte da Empresa",
      `${data.company.size.text} (${data.company.size.acronym})`
    );
    if (item) completeData.appendChild(item);
  }

  // Capital Social
  if (data.company?.equity) {
    const item = createInfoItem(
      "Capital Social",
      `R$ ${formatCurrency(data.company.equity)}`
    );
    if (item) completeData.appendChild(item);
  }

  // Regimes Especiais
  const regimes = [];
  if (data.company?.simples?.optant) {
    regimes.push(
      `Simples Nacional desde ${formatDate(data.company.simples.since)}`
    );
  }
  if (data.company?.simei?.optant) {
    regimes.push(`MEI desde ${formatDate(data.company.simei.since)}`);
  }
  if (regimes.length > 0) {
    const item = createInfoItem("Regimes Especiais", regimes);
    if (item) completeData.appendChild(item);
  }

  // Endereço completo
  if (data.address) {
    const addressFields = [
      { label: "Logradouro", value: data.address.street },
      { label: "Número", value: data.address.number },
      { label: "Complemento", value: data.address.details },
      { label: "Bairro", value: data.address.district },
      { label: "Cidade", value: data.address.city },
      { label: "Estado", value: data.address.state },
      { label: "CEP", value: formatCEP(data.address.zip) },
      { label: "País", value: data.address.country?.name },
      { label: "Código Município", value: data.address.municipality },
    ];

    addressFields.forEach((field) => {
      const item = createInfoItem(field.label, field.value);
      if (item) completeData.appendChild(item);
    });
  }

  // Contatos
  if (data.phones && data.phones.length > 0) {
    const phonesText = data.phones.map((phone) => {
      const tipo = phone.type === "LANDLINE" ? "Fixo" : "Celular";
      return `${tipo}: ${
        phone.area && phone.number
          ? formatPhone(`${phone.area}${phone.number}`)
          : phone.number
      }`;
    });
    const item = createInfoItem("Telefones", phonesText);
    if (item) completeData.appendChild(item);
  }

  if (data.emails && data.emails.length > 0) {
    const emailsText = data.emails.map((email) => {
      const tipo = email.ownership === "CORPORATE" ? "Corporativo" : "Outro";
      return `${tipo}: ${email.address}`;
    });
    const item = createInfoItem("E-mails", emailsText);
    if (item) completeData.appendChild(item);
  }

  // Atividades Econômicas
  if (data.mainActivity) {
    const item = createInfoItem(
      "CNAE Principal",
      `${data.mainActivity.id} - ${data.mainActivity.text}`
    );
    if (item) completeData.appendChild(item);
  }

  if (data.sideActivities && data.sideActivities.length > 0) {
    const secondaryActivities = data.sideActivities.map(
      (activity) => `${activity.id} - ${activity.text}`
    );
    const item = createInfoItem("CNAEs Secundários", secondaryActivities);
    if (item) completeData.appendChild(item);
  }

  // Inscrições Estaduais
  if (data.registrations && data.registrations.length > 0) {
    const ies = data.registrations.map((reg) => {
      const status = reg.enabled ? "✅" : "❌";
      return `${status} ${reg.number} - ${reg.state} (${reg.type?.text}) - ${reg.status?.text}`;
    });
    const item = createInfoItem("Inscrições Estaduais", ies);
    if (item) completeData.appendChild(item);
  }

  // SUFRAMA (se existir)
  if (data.suframa && data.suframa.length > 0) {
    const suframaItems = data.suframa.map((suf) => {
      const status = suf.approved ? "✅ Aprovado" : "❌ Pendente";
      return `Nº: ${suf.number} - ${status} - Desde: ${formatDate(suf.since)}`;
    });
    const item = createInfoItem("Registro SUFRAMA", suframaItems);
    if (item) completeData.appendChild(item);

    // Incentivos fiscais da SUFRAMA
    if (data.suframa[0].incentives && data.suframa[0].incentives.length > 0) {
      const incentivos = data.suframa[0].incentives.map(
        (inc) => `${inc.tribute}: ${inc.benefit} - ${inc.purpose}`
      );
      const itemInc = createInfoItem("Incentivos Fiscais SUFRAMA", incentivos);
      if (itemInc) completeData.appendChild(itemInc);
    }
  }

  // Sócios e Administradores
  if (data.company?.members && data.company.members.length > 0) {
    const socios = data.company.members.map((member) => {
      const since = member.since ? ` desde ${formatDate(member.since)}` : "";
      return `${member.person?.name} - ${member.role?.text}${since}`;
    });
    const item = createInfoItem("Sócios e Administradores", socios);
    if (item) completeData.appendChild(item);
  }
}

// Função para exibir os sócios na aba principal
function displayPartners(members) {
  partnersList.innerHTML = "";

  if (!members || members.length === 0) {
    partnersCard.classList.add("hidden");
    return;
  }

  console.log("👥 Sócios encontrados:", members);

  // Ordenar por data (mais recente primeiro) - CORREÇÃO AQUI
  const sortedMembers = [...members].sort((a, b) => {
    try {
      const dateA = a.since ? new Date(a.since) : new Date(0);
      const dateB = b.since ? new Date(b.since) : new Date(0);
      return dateB - dateA;
    } catch (e) {
      return 0;
    }
  });

  // Limitar a 6 sócios na aba principal
  const displayedMembers = sortedMembers.slice(0, 6);

  displayedMembers.forEach((member) => {
    const partnerItem = document.createElement("div");
    partnerItem.className = "partner-item";

    const partnerName = document.createElement("div");
    partnerName.className = "partner-name";
    partnerName.textContent = member.person?.name || "Nome não informado";

    const partnerRole = document.createElement("div");
    partnerRole.className = "partner-document";
    partnerRole.textContent = `Cargo: ${member.role?.text || "Não informado"}`;

    const partnerSince = document.createElement("div");
    partnerSince.className = "partner-qualification";
    partnerSince.textContent = `Desde: ${
      formatDate(member.since) || "Data não informada"
    }`;

    const partnerAge = document.createElement("div");
    partnerAge.className = "partner-qualification";
    partnerAge.textContent = `Faixa Etária: ${
      member.person?.age || "Não informada"
    }`;

    partnerItem.appendChild(partnerName);
    partnerItem.appendChild(partnerRole);
    partnerItem.appendChild(partnerSince);
    partnerItem.appendChild(partnerAge);

    partnersList.appendChild(partnerItem);
  });

  // Mostrar contador se houver mais sócios
  if (sortedMembers.length > 6) {
    const morePartners = document.createElement("div");
    morePartners.className = "partner-more";
    morePartners.textContent = `+ ${sortedMembers.length - 6} outros sócios...`;
    morePartners.style.textAlign = "center";
    morePartners.style.padding = "10px";
    morePartners.style.color = "var(--text-secondary)";
    morePartners.style.fontStyle = "italic";
    partnersList.appendChild(morePartners);
  }

  partnersCard.classList.remove("hidden");
}

// Função para formatar CNPJ como string
function formatCNPJString(cnpj) {
  if (!cnpj) return "";
  cnpj = cnpj.replace(/\D/g, "");
  return cnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
}

// Função para formatar CEP
function formatCEP(cep) {
  if (!cep) return "";
  cep = cep.replace(/\D/g, "");
  return cep.replace(/(\d{5})(\d{3})/, "$1-$2");
}

// Função para formatar telefone
function formatPhone(phone) {
  if (!phone) return "";
  phone = phone.replace(/\D/g, "");
  if (phone.length === 11) {
    return phone.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  } else if (phone.length === 10) {
    return phone.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  } else if (phone.length === 8) {
    return phone.replace(/(\d{4})(\d{4})/, "$1-$2");
  }
  return phone;
}

// Função para formatar data
function formatDate(dateString) {
  if (!dateString) return "";
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString("pt-BR");
  } catch (e) {
    return dateString;
  }
}

// Função para formatar data e hora
function formatDateTime(dateTimeString) {
  if (!dateTimeString) return "";
  try {
    const date = new Date(dateTimeString);
    return date.toLocaleString("pt-BR");
  } catch (e) {
    return dateTimeString;
  }
}

// Função para formatar moeda
function formatCurrency(value) {
  if (!value) return "0,00";
  return parseFloat(value).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Funções auxiliares para exibir/ocultar elementos
function showLoading() {
  loading.classList.remove("hidden");
}

function hideLoading() {
  loading.classList.add("hidden");
}

function showResult() {
  result.classList.remove("hidden");
}

function hideResult() {
  result.classList.add("hidden");
  partnersCard.classList.add("hidden");
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.classList.remove("hidden");
}

function clearError() {
  errorMessage.textContent = "";
  errorMessage.classList.add("hidden");
}

function disableSearchButton(disabled) {
  searchBtn.disabled = disabled;
  const buttonText = searchBtn.querySelector(".button-text");
  const buttonLoading = searchBtn.querySelector(".button-loading");

  if (disabled) {
    buttonText.classList.add("hidden");
    buttonLoading.classList.remove("hidden");
  } else {
    buttonText.classList.remove("hidden");
    buttonLoading.classList.add("hidden");
  }
}

// Carregar tema salvo ao iniciar
function loadSavedTheme() {
  const savedTheme = localStorage.getItem("theme");
  if (savedTheme === "light") {
    document.body.classList.remove("dark-mode");
    themeToggle.querySelector(".theme-icon").textContent = "🌙";
  } else {
    document.body.classList.add("dark-mode");
    themeToggle.querySelector(".theme-icon").textContent = "☀️";
  }
}

// Inicializar tema ao carregar a página
loadSavedTheme();
