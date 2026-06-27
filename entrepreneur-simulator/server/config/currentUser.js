const DEFAULT_USER_ID = String(process.env.DEFAULT_USER_ID || 'user-1').trim() || 'user-1';

function resolveUserId(userId) {
  const value = userId === undefined || userId === null ? '' : String(userId).trim();
  return value || DEFAULT_USER_ID;
}

module.exports = {
  DEFAULT_USER_ID,
  resolveUserId,
};
