export type Lang = "en" | "es";

// Every user-facing string lives here so the EN/ES toggle works everywhere,
// including the login page. Add new strings as nested keys and reference them
// with t("group.key").
export const dictionary: Record<Lang, Record<string, any>> = {
  en: {
    brand: {
      name: "Kitify Solutions",
      portal: "Partner Portal",
      tagline: "Solving your problems before you know you have them.",
    },
    login: {
      heading: "Partner sign in",
      sub: "Access training, jobs, orders, and the space configurator.",
      username: "Username",
      password: "Password",
      signIn: "Sign in",
      demoLabel: "Demo — sign in as",
      roleUser: "Partner",
      roleAdmin: "Administrator",
      invalidCredentials: "Only the administrator demo account can sign in at this time.",
      noAccount: "Not a partner yet?",
      requestAccess: "Request access",
    },
    request: {
      heading: "Request access",
      sub: "Tell us about your business and we'll reach out to set you up.",
      name: "Full name",
      company: "Company name",
      email: "Email",
      phone: "Phone",
      location: "City & state",
      role: "Your trade or role",
      volume: "Bathrooms per month (estimate)",
      heard: "How did you hear about Kitify?",
      submit: "Submit request",
      back: "Back to sign in",
      thanksTitle: "Request received",
      thanksBody:
        "Thanks — a Kitify team member will review your request and reach out to get you set up.",
    },
    header: {
      welcome: "Welcome back, {name}",
      logout: "Sign out",
      roleUser: "Partner",
      roleAdmin: "Administrator",
    },
    nav: {
      dashboard: "Dashboard",
      training: "Training",
      registerJob: "Register a job",
      workSamples: "Work samples",
      claims: "Claims",
      orderTracking: "Order tracking",
      orders: "Place an order",
      configurator: "Space configurator",
      adminSection: "Admin",
      approvals: "Access requests",
      content: "Content",
    },
    dashboard: {
      title: "Dashboard",
      blogTitle: "From Kitify",
      blogDesc: "News, how-to, and updates from the network.",
      productTitle: "Product updates",
      productDesc: "New products, spec changes, and pricing.",
      featuredTitle: "Featured projects",
      featuredDesc: "Standout installs from across the network.",
      leadsTitle: "Leads",
      leadsDesc: "Leads routed to you, with status and next step.",
      ordersTitle: "Order overview",
      ordersDesc: "A snapshot of your open and recent orders.",
      empty: "Nothing here yet.",
    },
    pages: {
      training: {
        title: "Training",
        desc: "Kitify University — certification modules, quizzes, and progress.",
        points: [
          "Video and lesson modules with quizzes and progress tracking",
          "Certification issued on completion; requirements defined per partner level (in review)",
          "Continuing-education modules for new products and updated standards",
        ],
      },
      registerJob: {
        title: "Register a job",
        desc: "Log a completed install for warranty coverage and job history.",
        points: [
          "Capture job address, product or kit used, install date, and homeowner contact",
          "Generates a unique job ID that claims attach to",
          "Full, searchable job history for the partner and for Kitify staff",
        ],
      },
      workSamples: {
        title: "Work samples",
        desc: "Upload install photos and video to earn and keep certification.",
        points: [
          "Upload photos and video per job, with tagging and review status",
          "Approved samples can feed Featured Projects on the dashboard",
          "Submission and review requirements are being finalized",
        ],
      },
      claims: {
        title: "Claims",
        desc: "File and track warranty or product claims against a registered job.",
        points: [
          "Link a claim to a registered job by its job ID",
          "Attach issue type, photos, and a status timeline",
          "Full scope is pending — placeholder in the current build",
        ],
      },
      orderTracking: {
        title: "Order tracking",
        desc: "Follow orders from confirmed through production, shipping, and delivery.",
        points: [
          "Order list with a per-order status timeline",
          "Consolidation and shipping status",
          "Invoices and packing documents in one place",
        ],
      },
      orders: {
        title: "Place an order",
        desc: "Configure and place an order with pricing set by your partner level.",
        points: [
          "Select products and kits and build a cart",
          "Pricing reflects your partner level",
          "Basic in this build; checkout and payment come in a later update",
        ],
      },
      configurator: {
        title: "Space configurator",
        desc: "Photograph a client's space and preview it with Kitify products.",
        points: [
          "Capture the space by photo (or LiDAR) and overlay Kitify products",
          "Before / after view to help close the sale on site",
          "The marquee feature — approach still being decided (photorealism vs. exact-product fidelity)",
        ],
      },
      approvals: {
        title: "Access requests",
        desc: "Review incoming partner requests and create accounts.",
        points: [
          "Queue of incoming access requests with full contact details",
          "Approve or decline, then manually create the partner account",
          "Every request is tracked so nothing falls through",
        ],
      },
      content: {
        title: "Content",
        desc: "Publish blog posts, product updates, and featured projects.",
        points: [
          "Publish and edit blog posts and product updates",
          "Promote approved work samples to Featured Projects",
          "Manage English and Spanish versions of editable content",
        ],
      },
    },
    status: {
      inDevelopment: "In development",
      placeholder: "This page is a placeholder in the current build.",
      whatsComing: "What this page will do",
    },
    lang: { toggle: "ES", label: "Language" },
  },

  es: {
    brand: {
      name: "Kitify Solutions",
      portal: "Portal de Socios",
      tagline: "Resolvemos sus problemas antes de que sepa que los tiene.",
    },
    login: {
      heading: "Acceso de socios",
      sub: "Capacitación, trabajos, pedidos y el configurador de espacios.",
      username: "Usuario",
      password: "Contraseña",
      signIn: "Iniciar sesión",
      demoLabel: "Demo — iniciar como",
      roleUser: "Socio",
      roleAdmin: "Administrador",
      invalidCredentials: "Solo la cuenta demo de administrador puede iniciar sesión en este momento.",
      noAccount: "¿Aún no es socio?",
      requestAccess: "Solicitar acceso",
    },
    request: {
      heading: "Solicitar acceso",
      sub: "Cuéntenos sobre su negocio y nos pondremos en contacto para configurarlo.",
      name: "Nombre completo",
      company: "Nombre de la empresa",
      email: "Correo electrónico",
      phone: "Teléfono",
      location: "Ciudad y estado",
      role: "Su oficio o función",
      volume: "Baños por mes (estimado)",
      heard: "¿Cómo se enteró de Kitify?",
      submit: "Enviar solicitud",
      back: "Volver al inicio de sesión",
      thanksTitle: "Solicitud recibida",
      thanksBody:
        "Gracias — un miembro del equipo de Kitify revisará su solicitud y se pondrá en contacto para configurarlo.",
    },
    header: {
      welcome: "Bienvenido de nuevo, {name}",
      logout: "Cerrar sesión",
      roleUser: "Socio",
      roleAdmin: "Administrador",
    },
    nav: {
      dashboard: "Panel",
      training: "Capacitación",
      registerJob: "Registrar trabajo",
      workSamples: "Muestras de trabajo",
      claims: "Reclamos",
      orderTracking: "Seguimiento de pedidos",
      orders: "Realizar pedido",
      configurator: "Configurador de espacios",
      adminSection: "Administración",
      approvals: "Solicitudes de acceso",
      content: "Contenido",
    },
    dashboard: {
      title: "Panel",
      blogTitle: "Desde Kitify",
      blogDesc: "Noticias, guías y novedades de la red.",
      productTitle: "Novedades de producto",
      productDesc: "Nuevos productos, cambios de especificación y precios.",
      featuredTitle: "Proyectos destacados",
      featuredDesc: "Instalaciones sobresalientes de toda la red.",
      leadsTitle: "Prospectos",
      leadsDesc: "Prospectos asignados a usted, con estado y siguiente paso.",
      ordersTitle: "Resumen de pedidos",
      ordersDesc: "Un vistazo de sus pedidos abiertos y recientes.",
      empty: "Aún no hay nada aquí.",
    },
    pages: {
      training: {
        title: "Capacitación",
        desc: "Kitify University — módulos de certificación, cuestionarios y progreso.",
        points: [
          "Módulos de video y lecciones con cuestionarios y seguimiento de progreso",
          "Certificación al completar; los requisitos por nivel de socio están en revisión",
          "Módulos de educación continua para nuevos productos y estándares actualizados",
        ],
      },
      registerJob: {
        title: "Registrar trabajo",
        desc: "Registre una instalación terminada para garantía e historial.",
        points: [
          "Registre dirección, producto o kit usado, fecha de instalación y contacto del cliente",
          "Genera un ID de trabajo único al que se vinculan los reclamos",
          "Historial de trabajos completo y con búsqueda para el socio y el equipo de Kitify",
        ],
      },
      workSamples: {
        title: "Muestras de trabajo",
        desc: "Suba fotos y video de la instalación para obtener y mantener la certificación.",
        points: [
          "Suba fotos y video por trabajo, con etiquetas y estado de revisión",
          "Las muestras aprobadas pueden alimentar Proyectos Destacados en el panel",
          "Los requisitos de envío y revisión se están finalizando",
        ],
      },
      claims: {
        title: "Reclamos",
        desc: "Presente y siga reclamos de garantía o producto sobre un trabajo registrado.",
        points: [
          "Vincule un reclamo a un trabajo registrado por su ID",
          "Adjunte tipo de problema, fotos y una línea de tiempo de estado",
          "El alcance completo está pendiente — marcador de posición en esta versión",
        ],
      },
      orderTracking: {
        title: "Seguimiento de pedidos",
        desc: "Siga los pedidos desde confirmado hasta producción, envío y entrega.",
        points: [
          "Lista de pedidos con línea de tiempo de estado por pedido",
          "Estado de consolidación y envío",
          "Facturas y documentos de empaque en un solo lugar",
        ],
      },
      orders: {
        title: "Realizar pedido",
        desc: "Configure y realice un pedido con precios según su nivel de socio.",
        points: [
          "Seleccione productos y kits y arme un carrito",
          "El precio refleja su nivel de socio",
          "Básico en esta versión; el pago llega en una actualización posterior",
        ],
      },
      configurator: {
        title: "Configurador de espacios",
        desc: "Fotografíe el espacio de un cliente y visualícelo con productos Kitify.",
        points: [
          "Capture el espacio con foto (o LiDAR) y superponga productos Kitify",
          "Vista antes / después para ayudar a cerrar la venta en el sitio",
          "La función estrella — el enfoque aún se está decidiendo (fotorrealismo vs. fidelidad exacta)",
        ],
      },
      approvals: {
        title: "Solicitudes de acceso",
        desc: "Revise las solicitudes de socios y cree cuentas.",
        points: [
          "Cola de solicitudes de acceso con datos de contacto completos",
          "Apruebe o rechace, luego cree manualmente la cuenta del socio",
          "Cada solicitud se registra para que nada se pierda",
        ],
      },
      content: {
        title: "Contenido",
        desc: "Publique entradas de blog, novedades de producto y proyectos destacados.",
        points: [
          "Publique y edite entradas de blog y novedades de producto",
          "Promueva muestras aprobadas a Proyectos Destacados",
          "Gestione las versiones en inglés y español del contenido editable",
        ],
      },
    },
    status: {
      inDevelopment: "En desarrollo",
      placeholder: "Esta página es un marcador de posición en la versión actual.",
      whatsComing: "Qué hará esta página",
    },
    lang: { toggle: "EN", label: "Idioma" },
  },
};

export function translate(lang: Lang, key: string, vars?: Record<string, string>): string {
  const parts = key.split(".");
  let cur: any = dictionary[lang];
  for (const p of parts) {
    cur = cur?.[p];
    if (cur == null) return key;
  }
  let out = typeof cur === "string" ? cur : key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      out = out.replace(new RegExp(`\\{${k}\\}`, "g"), v);
    }
  }
  return out;
}

export function translateList(lang: Lang, key: string): string[] {
  const parts = key.split(".");
  let cur: any = dictionary[lang];
  for (const p of parts) {
    cur = cur?.[p];
    if (cur == null) return [];
  }
  return Array.isArray(cur) ? cur : [];
}
