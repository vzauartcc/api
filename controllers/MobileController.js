import e from "express";
const router = e.Router();
import jwt from "jsonwebtoken";
import User from '../models/User.js';
import dotenv from "dotenv"

dotenv.config();

router.post('/login', async (req, res) => {
    try {
        const secret = req.headers['x-secret'];
        console.log(secret);
        if (secret !== process.env.MOBILE_LOGIN_SECRET) {
          res.status(401).send('Unauthorized');
          return;
        }

        // Use access token to attempt to get user data.
        let vatsimUserData = req.body;
    
        // VATSIM API returns 200 codes on some errors, use CID as a check to see if there was an error.
        if (vatsimUserData?.data?.cid == null) {
          let error = vatsimUserData;
          throw error;
        } else {
          vatsimUserData = vatsimUserData.data;
        }
    
        const userData = {
          email: vatsimUserData.personal.email,
          firstName: vatsimUserData.personal.name_first,
          lastName: vatsimUserData.personal.name_last,
          cid: vatsimUserData.cid,
          ratingId: vatsimUserData.vatsim.rating.id,
        };
    
        // If the user did not authorize all requested data from the AUTH login, we may have null parameters
        // If that is the case throw a BadRequest exception.
        if (Object.values(userData).some((x) => x == null || x == "")) {
          throw {
            code: 400,
            message:
              "User must authorize all requested VATSIM data. [Authorize Data]",
          };
        }
    
        // Find the user in the database using the CID
        let user = await User.findOne({ cid: userData.cid });
  
        if (!user) {
            // Return an error response if the user is not found
            return res.status(401).json({ message: 'User not found' });
        }
  
        // Create a JWT token for the user
        const token = jwt.sign({ cid: user.cid }, process.env.JWT_SECRET, {
            expiresIn: '30d',
        });
        // Return the token to the client
        return res.json({ token });
    } catch (err) {
      // Handle any errors that occur during the login process
      console.error(err);
      return res.status(500).json({ message: 'Internal server error' });
    }
});

export default router;