(() => {
  const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
  return articles.map(art => {
    // 过滤广告 / 赞助帖
    const isAd = art.innerHTML.includes('广告') || 
                 art.innerHTML.includes('Promoted') || 
                 !!art.querySelector('[data-testid="placementTracking"]');

    // 1. 用户信息提取
    const userNames = Array.from(art.querySelectorAll('[data-testid="User-Name"]'));
    const mainUserEl = userNames[0];
    const authorName = mainUserEl ? (mainUserEl.querySelector('span')?.innerText || mainUserEl.innerText.split('\n')[0]).trim() : '';
    const handleMatch = mainUserEl ? mainUserEl.innerText.match(/@[a-zA-Z0-9_]+/) : null;
    const authorHandle = handleMatch ? handleMatch[0] : '';
    const isVerified = !!art.querySelector('svg[data-testid="icon-verified"]');
    
    const avatarImg = art.querySelector('div[data-testid*="UserAvatar"] img') || 
                      art.querySelector('[data-testid="Tweet-User-Avatar"] img') || 
                      art.querySelector('img[src*="profile_images"]');
    const avatarUrl = avatarImg ? avatarImg.src : null;
    const profileLink = mainUserEl ? mainUserEl.querySelector('a') : null;
    const profileUrl = profileLink ? profileLink.href : (authorHandle ? 'https://x.com/' + authorHandle.replace('@', '') : null);
    
    // 2. 推文链接与 ID
    const statusLinks = Array.from(art.querySelectorAll('a[href*="/status/"]')).map(a => a.href);
    const mainStatusUrl = statusLinks.find(l => !l.includes('/photo/') && !l.includes('/video/') && !l.includes('/analytics')) || statusLinks[0] || '';
    const idMatch = mainStatusUrl.match(/\/status\/(\d+)/);
    const tweetId = idMatch ? idMatch[1] : '';
    
    // 3. 发布时间 (ISO 8601)
    const timeEl = art.querySelector('time');
    const publishedAt = timeEl ? timeEl.getAttribute('datetime') : null;
    
    // 4. 正文与引用推文
    const tweetTextEls = Array.from(art.querySelectorAll('[data-testid="tweetText"]'));
    const rawText = tweetTextEls[0] ? tweetTextEls[0].innerText : '';
    
    let quotedTweet = null;
    if (tweetTextEls.length > 1 || userNames.length > 1) {
      const qUserEl = userNames[1];
      const qHandleMatch = qUserEl ? qUserEl.innerText.match(/@[a-zA-Z0-9_]+/) : null;
      const qStatusLink = statusLinks.find(l => tweetId && !l.includes(tweetId));
      quotedTweet = {
        author: qUserEl ? qUserEl.innerText.split('\n')[0].trim() : '',
        handle: qHandleMatch ? qHandleMatch[0] : '',
        rawText: tweetTextEls[1] ? tweetTextEls[1].innerText : '',
        url: qStatusLink || ''
      };
    }
    
    // 5. 互动指标 (replies, reposts, likes, bookmarks, views)
    const groupEl = art.querySelector('[role="group"]');
    const rawMetrics = groupEl ? (groupEl.getAttribute('aria-label') || groupEl.innerText.replace(/\n+/g, ' ')) : '';
    
    const parseNum = (str, pattern) => {
      const m = str.match(pattern);
      if (!m) return 0;
      return parseInt(m[1].replace(/,/g, ''), 10) || 0;
    };
    
    const replies = parseNum(rawMetrics, /(\d[\d,]*)\s*(?:回复|replies|reply)/i);
    const reposts = parseNum(rawMetrics, /(\d[\d,]*)\s*(?:次转帖|reposts|repost|retweets)/i);
    const likes = parseNum(rawMetrics, /(\d[\d,]*)\s*(?:喜欢|likes|like)/i);
    const bookmarks = parseNum(rawMetrics, /(\d[\d,]*)\s*(?:书签|bookmarks|bookmark)/i);
    const views = parseNum(rawMetrics, /(\d[\d,]*)\s*(?:次观看|views|view)/i);
    
    // 6. 媒体元素标记与提取 (支持照片链接、图片标签与视频标记)
    const hasPhotoLink = statusLinks.some(l => l.includes('/photo/'));
    const photoImgs = Array.from(art.querySelectorAll('[data-testid="tweetPhoto"] img, [aria-label="Image"] img, img[src*="pbs.twimg.com/media/"]'));
    const images = photoImgs.map(img => {
      let src = img.src;
      if (src.includes('name=')) {
        src = src.replace(/name=[a-zA-Z0-9_]+/, 'name=orig');
      } else if (src.includes('?')) {
        src += '&name=orig';
      }
      return src;
    }).filter((v, i, a) => a.indexOf(v) === i);
    
    const hasVideo = !!art.querySelector('video') || 
                     art.innerHTML.includes('amplify_video_thumb') || 
                     statusLinks.some(l => l.includes('/video/'));
    
    const hasImage = hasPhotoLink || images.length > 0;
    
    return {
      id: tweetId,
      url: mainStatusUrl,
      isAd,
      author: {
        name: authorName,
        handle: authorHandle,
        verified: isVerified,
        avatar: avatarUrl,
        profileUrl
      },
      publishedAt,
      rawText,
      metrics: {
        replies,
        reposts,
        likes,
        bookmarks,
        views,
        rawMetrics
      },
      quotedTweet,
      media: {
        hasImage,
        images,
        hasVideo
      }
    };
  }).filter(t => !t.isAd && t.id && t.url);
})();
