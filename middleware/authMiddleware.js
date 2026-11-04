const jwt = require("jsonwebtoken");

const verifyAdmin = (req, res, next) => {
  // Authentication middleware to verify the admin user using JWT token
  const authHeader = req.header("Authorization");
  if (!authHeader) {
    return res.status(401).json({ error: "גישה נדחתה. חסר טוקן אימות." });
  }

  try {
    // Remove the "Bearer " prefix from the token string
    const token = authHeader.replace("Bearer ", "");
    // Verify the token using the secret key
    // [Abuse protection] Only accept HS256 - the algorithm our tokens are signed with
    const verified = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
    });

    // Attach the verified admin user to the request object for further use
    req.admin = verified;
    next();
  } catch (error) {
    res.status(401).json({ error: "טוקן לא חוקי או פג תוקף." });
  }
};

module.exports = { verifyAdmin };
