// Database connection stub
export const database = {
  async query(sql: string, params?: unknown[]) {
    // Would execute SQL query
    return { rows: [] };
  },

  async connect() {
    // Would establish connection
  },

  async disconnect() {
    // Would close connection
  },
};
