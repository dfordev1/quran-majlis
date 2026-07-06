// GET /api/whoami — tells the client whether the signed-in user is an admin.
// UI-only convenience: the real enforcement is server-side in api/admin.js.
const L = require('./_lib');

module.exports = async (req, res) => {
  L.cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const user = await L.getUser(req);
  if (!user) return res.status(200).json({ signedIn: false, isAdmin: false });
  res.status(200).json({ signedIn: true, email: user.email, name: user.name, isAdmin: L.isAdmin(user) });
};
