const protectedServerModules = new Set([
  "@/lib/supabase/admin",
  "@/lib/supabase/server",
  "@/lib/auth-throttle",
  "@/lib/customers-admin",
]);

export const noServerImportInClient = {
  meta: {
    type: /** @type {const} */ ("problem"),
    docs: {
      description:
        "Impide importar clientes privilegiados de Supabase desde componentes cliente.",
    },
    messages: {
      forbidden:
        "Un componente con 'use client' no puede importar {{moduleName}}.",
    },
    schema: [],
  },
  create(context) {
    let isClientModule = false;

    function checkSource(node) {
      if (
        isClientModule &&
        typeof node.source?.value === "string" &&
        protectedServerModules.has(node.source.value)
      ) {
        context.report({
          node,
          messageId: "forbidden",
          data: { moduleName: node.source.value },
        });
      }
    }

    return {
      Program(node) {
        isClientModule = node.body.some(
          (statement) =>
            statement.type === "ExpressionStatement" &&
            statement.expression.type === "Literal" &&
            statement.expression.value === "use client",
        );
      },
      ImportDeclaration: checkSource,
      ExportNamedDeclaration: checkSource,
      ExportAllDeclaration: checkSource,
    };
  },
};
