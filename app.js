const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const databasePath = path.join(__dirname, "twitterClone.db");

const app = express();

app.use(express.json());

let database = null;

const initializeDbAndServer = async () => {
  try {
    database = await open({
      filename: databasePath,
      driver: sqlite3.Database,
    });

    app.listen(3000, () =>
      console.log("Server Running at http://localhost:3000/")
    );
  } catch (error) {
    console.log(`DB Error: ${error.message}`);
    process.exit(1);
  }
};

initializeDbAndServer();


const convertTodoDBObjectToResponseObject = (dbObject) => {
  return {
    id: dbObject.id,
    todo: dbObject.todo,
    category: dbObject.category,
    priority: dbObject.priority,
    status: dbObject.status,
    dueDate: dbObject.due_date
  }
}


//logger middleware
const logger = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers['authorization'];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(' ')[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken,"Neil", (error,payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
}

//validate tweet middleware
const validateTweet = async (request, response, next) => {
  const {username} = request;
  const {tweetId} = request.params;
  const getTweetDataQuery = `
  SELECT *
  FROM tweet 
  WHERE
  user_id IN (
    SELECT user.user_id
    FROM user INNER JOIN follower ON user.user_id = follower.following_user_id
    WHERE
    follower.follower_user_id = (
      SELECT user_id FROM user WHERE username='${username}'
    )
  )
  AND tweet_id = ${tweetId};
  `;
  const tweetData = await database.get(getTweetDataQuery);
  if (tweetData !== undefined) {
    next();
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
}

// validate user tweet middleware
const validateUserTweet = async (request, response, next) => {
  const {username} = request;
  const {tweetId} = request.params;
  const getTweetDataQuery = `
  SELECT *
  FROM tweet 
  WHERE
  user_id = (
    SELECT user_id FROM user WHERE username='${username}'
  )
  AND tweet_id = ${tweetId};
  `;
  const tweetData = await database.get(getTweetDataQuery);
  if (tweetData !== undefined) {
    next();
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
}

//register user api
app.post("/register/", async (request, response) => {
  const { username, name, password, gender} = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`;
  const dbUser = await database.get(selectUserQuery);
  if (dbUser === undefined) {
    const isValidPassword = password.length >= 6
    if (isValidPassword){
      const createUserQuery = `
        INSERT INTO 
          user (username, name, password, gender) 
        VALUES 
          (
            '${username}', 
            '${name}',
            '${hashedPassword}', 
            '${gender}'
          )`;
      await database.run(createUserQuery);
      response.status(200);
      response.send("User created successfully");
    } else {
      response.status(400);
      response.send("Password is too short");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

//login user api
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`;
  const dbUser = await database.get(selectUserQuery);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched === true) {
      const payload = {username};
      const jwtToken = jwt.sign(payload,"Neil");
      response.send({jwtToken});
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});


//api 3
app.get("/user/tweets/feed", logger, async (request, response) => {
  const {username} = request;
  const getUserFeedQuery = `
    SELECT
    user.username, tweet.tweet, tweet.date_time as dateTime
    FROM
    follower INNER JOIN user ON follower.following_user_id = user.user_id
    NATURAL JOIN tweet
    ORDER BY
    tweet.date_time desc
    LIMIT 4;
  `;
  const userFeedData = await database.all(getUserFeedQuery);
  response.send(userFeedData);
});

// api 4
app.get("/user/following",logger, async (request, response) => {
  const {username} = request;
  const getFollowingQuery = `
  SELECT name
  FROM user INNER JOIN follower ON user.user_id = follower.following_user_id
  WHERE
  follower.follower_user_id = (
    SELECT user_id FROM user WHERE username='${username}'
  );
  `;
  const userFollowingData = await database.all(getFollowingQuery);
  response.send(userFollowingData);
});

// api 5
app.get("/user/followers",logger, async (request,response) => {
  const {username} = request;
  const getFollowersQuery = `
  SELECT name
  FROM user INNER JOIN follower ON user.user_id = follower.follower_user_id
  WHERE
  follower.following_user_id = (
    SELECT user_id FROM user WHERE username='${username}'
  );
  `;
  const userFollowersData = await database.all(getFollowersQuery);
  response.send(userFollowersData);
});

// api 6
app.get("/tweets/:tweetId",logger,validateTweet,async (request, response) => {
  const {tweetId} = request.params;
  const getTweetDetailsQuery = `
  SELECT tweet.tweet,count(DISTINCT reply.reply_id) as replies, count(DISTINCT like.like_id) as likes, tweet.date_time as dateTime
  FROM reply 
    LEFT JOIN like ON reply.tweet_id = like.tweet_id
    LEFT JOIN tweet ON like.tweet_id = tweet.tweet_id 
  WHERE
  tweet.tweet_id = ${tweetId};
  `;

  const tweetDetails = await database.get(getTweetDetailsQuery);
  response.send(tweetDetails);
});

// api 7
app.get("/tweets/:tweetId/likes",logger,validateTweet,async (request,response) => {
  const {tweetId} = request.params;
  const getUserLikesQuery = `
  SELECT username
  FROM like NATURAL JOIN user
  WHERE like.tweet_id = ${tweetId};
  `;

  const userLikes = await database.all(getUserLikesQuery);
  const userLikesArray = userLikes.map(item => item.username);
  response.send({"likes": userLikesArray});
});

// api 8
app.get("/tweets/:tweetId/replies",logger,validateTweet,async (request,response) => {
  const {tweetId} = request.params;
  const getUserRepliesQuery = `
  SELECT username
  FROM reply NATURAL JOIN user
  WHERE reply.tweet_id = ${tweetId};
  `;

  const userReplies = await database.all(getUserRepliesQuery);
  const userRepliesArray = userReplies.map(item => item.username);
  response.send({"replies": userRepliesArray});
});

// api 9
app.get("/user/tweets",logger, async (request,response) => {
  const {username} = request;
  const getTweetsQuery = `
  SELECT tweet.tweet,count(DISTINCT reply.reply_id) as replies, count(DISTINCT like.like_id) as likes, tweet.date_time as dateTime
  FROM reply 
    LEFT JOIN like ON reply.tweet_id = like.tweet_id
    LEFT JOIN tweet ON like.tweet_id = tweet.tweet_id
    LEFT JOIN user ON user.user_id = tweet.user_id
  WHERE user.username = '${username}'
  GROUP BY
  tweet.tweet_id;
  `;

  const userTweets = await database.all(getTweetsQuery);
  response.send(userTweets);
});

// api 10
app.post("/user/tweets",logger, async (request,response) => {
  const {tweet} = request.body;
  const postTweetQuery = `
  INSERT INTO tweet (tweet)
  VALUES ('${tweet}');
  `;

  await database.run(postTweetQuery);
  response.send("Created a Tweet");
});

// api 11
app.delete("/tweets/:tweetId",logger,validateUserTweet,async (request,response) => {
  const {tweetId} = request.params;
  const deleteTweetQuery = `
  DELETE FROM tweet
  WHERE tweet_id = ${tweetId};
  `;

  await database.run(deleteTweetQuery);
  response.send("Tweet Removed");
});

module.exports = app;
