const crypto = require('crypto');
const normalizeUrl = require('normalize-url');
const { logger } = require('./logger');
const { redis } = require('../lib/redis');

const standardize = (url, type) => {
  let namespace = 't:post:';
  let processed = url;

  if (type === 'feed') {
    namespace = 't:feed:';
    processed = normalizeUrl(url);
  }

  try {
    return namespace.concat(
      crypto
        .createHash('sha256')
        .update(processed)
        .digest('base64')
    );
  } catch (error) {
    logger.error(`There was an error processing ${url}`);
    throw error;
  }
};

// Redis Keys
const FEEDS = 'feeds';

const POSTS = 'posts';

module.exports = {
  addFeed: async (name, url) => {
    const feedId = standardize(url, 'feed');
    await redis
      .multi()
      // Using hmset() until hset() fully supports multiple fields:
      // https://github.com/stipsan/ioredis-mock/issues/345
      // https://github.com/luin/ioredis/issues/551
      .hmset(feedId, 'name', name, 'url', url)
      .sadd(FEEDS, feedId)
      .exec();
    return feedId;
  },

  getFeeds: () => redis.smembers(FEEDS),

  getFeed: feedID => redis.hgetall(feedID),

  getFeedsCount: () => redis.scard(FEEDS),

  addPost: async post => {
    const key = standardize(post.guid, 'post');

    await redis
      .multi()
      .hmset(
        // using guid as keys as it is unique to posts
        key,
        'author',
        post.author,
        'title',
        post.title,
        'html',
        post.html,
        'text',
        post.text,
        'published',
        post.published,
        'updated',
        post.updated,
        'url',
        post.url,
        'site',
        post.site,
        'guid',
        post.guid
      )
      // sort set by published date as scores
      .zadd(POSTS, post.published.getTime(), key)
      .exec();
  },

  /**
   * Returns an array of guids from redis
   * @param from lower index
   * @param to higher index, it needs -1 because redis includes the element at this index in the returned array
   * @return Array of guids
   */
  getPosts: async (from, to) => {
    const keys = await redis.zrevrange(POSTS, from, to - 1);

    /**
     * 'zrevrange returns an array of encrypted hashed guids.
     * This array is used to return the 'guid' property in
     * Post objects, which contains the unencrypted, unhashed version
     * of the guid
     */
    return Promise.all(
      keys.map(async key => {
        const { guid } = await redis.hgetall(key);
        return guid.replace('/t:post:/', '');
      })
    );
  },

  getPostsCount: () => redis.zcard(POSTS),

  getPost: async guid => redis.hgetall(standardize(guid, 'post')),
};
