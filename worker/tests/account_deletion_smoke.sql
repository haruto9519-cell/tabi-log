PRAGMA foreign_keys=ON;

INSERT INTO users(id,display_name) VALUES
 ('account-delete-test','Delete test'),
 ('account-keep-test','Keep test');

INSERT INTO trips(id,user_id,title,area) VALUES
 ('trip-delete-test','account-delete-test','Delete trip','Area'),
 ('trip-keep-test','account-keep-test','Keep trip','Area');

INSERT INTO trip_stops(id,trip_id,name) VALUES
 ('stop-delete-test','trip-delete-test','Delete stop'),
 ('stop-keep-test','trip-keep-test','Keep stop');

INSERT INTO itinerary_items(id,trip_id,day_date,name) VALUES
 ('item-delete-test','trip-delete-test','2026-01-01','Delete item'),
 ('item-keep-test','trip-keep-test','2026-01-01','Keep item');

INSERT INTO posts(id,user_id,trip_id,title,story,place_name) VALUES
 ('post-delete-test','account-delete-test','trip-delete-test','Delete post','Story','Place'),
 ('post-keep-test','account-keep-test','trip-keep-test','Keep post','Story','Place');

INSERT INTO likes(user_id,post_id) VALUES
 ('account-delete-test','post-keep-test'),
 ('account-keep-test','post-delete-test'),
 ('account-keep-test','post-keep-test');

INSERT INTO comments(id,user_id,post_id,body) VALUES
 ('comment-delete-test','account-delete-test','post-keep-test','Delete comment'),
 ('comment-on-delete-post','account-keep-test','post-delete-test','Comment on deleted post'),
 ('comment-keep-test','account-keep-test','post-keep-test','Keep comment');

INSERT INTO follows(follower_id,followed_id) VALUES
 ('account-delete-test','account-keep-test'),
 ('account-keep-test','account-delete-test');

INSERT INTO saved_trips(user_id,trip_id) VALUES
 ('account-delete-test','trip-keep-test'),
 ('account-keep-test','trip-delete-test'),
 ('account-keep-test','trip-keep-test');

INSERT INTO blocks(blocker_id,blocked_id) VALUES
 ('account-delete-test','account-keep-test'),
 ('account-keep-test','account-delete-test');

INSERT INTO reports(id,reporter_id,target_type,target_id,reason) VALUES
 ('report-delete-test','account-delete-test','post','post-keep-test','test'),
 ('report-keep-test','account-keep-test','user','account-delete-test','test');

INSERT INTO travel_expenses(id,user_id,trip_id,expense_date,category,amount) VALUES
 ('expense-delete-test','account-delete-test','trip-delete-test','2026-01-01','food',100),
 ('expense-keep-test','account-keep-test','trip-keep-test','2026-01-01','food',100);

INSERT INTO auth_sessions(token_hash,user_id,created_at,expires_at) VALUES
 ('session-delete-test','account-delete-test',1,9999999999),
 ('session-keep-test','account-keep-test',1,9999999999);

INSERT INTO plan_imports(id,token_hash,payload_json,created_at,expires_at,claimed_by) VALUES
 ('import-delete-test','import-token-delete','{}',1,9999999999,'account-delete-test'),
 ('import-keep-test','import-token-keep','{}',1,9999999999,'account-keep-test');

INSERT INTO share_links(id,token_hash,revoke_hash,payload_json,created_at,expires_at,owner_id) VALUES
 ('share-delete-test','share-token-delete','revoke-delete','{}',1,9999999999,'account-delete-test'),
 ('share-keep-test','share-token-keep','revoke-keep','{}',1,9999999999,'account-keep-test');

DELETE FROM likes WHERE user_id='account-delete-test' OR post_id IN (SELECT id FROM posts WHERE user_id='account-delete-test');
DELETE FROM comments WHERE user_id='account-delete-test' OR post_id IN (SELECT id FROM posts WHERE user_id='account-delete-test');
DELETE FROM follows WHERE follower_id='account-delete-test' OR followed_id='account-delete-test';
DELETE FROM saved_trips WHERE user_id='account-delete-test' OR trip_id IN (SELECT id FROM trips WHERE user_id='account-delete-test');
DELETE FROM blocks WHERE blocker_id='account-delete-test' OR blocked_id='account-delete-test';
DELETE FROM reports WHERE reporter_id='account-delete-test';
DELETE FROM travel_expenses WHERE user_id='account-delete-test' OR trip_id IN (SELECT id FROM trips WHERE user_id='account-delete-test');
DELETE FROM itinerary_items WHERE trip_id IN (SELECT id FROM trips WHERE user_id='account-delete-test');
DELETE FROM trip_stops WHERE trip_id IN (SELECT id FROM trips WHERE user_id='account-delete-test');
DELETE FROM posts WHERE user_id='account-delete-test';
DELETE FROM trips WHERE user_id='account-delete-test';
DELETE FROM plan_imports WHERE claimed_by='account-delete-test';
DELETE FROM share_links WHERE owner_id='account-delete-test';
DELETE FROM auth_sessions WHERE user_id='account-delete-test';
DELETE FROM users WHERE id='account-delete-test';

SELECT CASE WHEN
 (SELECT COUNT(*) FROM users WHERE id='account-delete-test')=0 AND
 (SELECT COUNT(*) FROM users WHERE id='account-keep-test')=1 AND
 (SELECT COUNT(*) FROM trips WHERE user_id='account-delete-test')=0 AND
 (SELECT COUNT(*) FROM trips WHERE id='trip-keep-test')=1 AND
 (SELECT COUNT(*) FROM posts WHERE user_id='account-delete-test')=0 AND
 (SELECT COUNT(*) FROM posts WHERE id='post-keep-test')=1 AND
 (SELECT COUNT(*) FROM trip_stops WHERE trip_id='trip-delete-test')=0 AND
 (SELECT COUNT(*) FROM trip_stops WHERE id='stop-keep-test')=1 AND
 (SELECT COUNT(*) FROM itinerary_items WHERE trip_id='trip-delete-test')=0 AND
 (SELECT COUNT(*) FROM itinerary_items WHERE id='item-keep-test')=1 AND
 (SELECT COUNT(*) FROM likes WHERE user_id='account-delete-test' OR post_id='post-delete-test')=0 AND
 (SELECT COUNT(*) FROM likes WHERE user_id='account-keep-test' AND post_id='post-keep-test')=1 AND
 (SELECT COUNT(*) FROM comments WHERE user_id='account-delete-test' OR post_id='post-delete-test')=0 AND
 (SELECT COUNT(*) FROM comments WHERE id='comment-keep-test')=1 AND
 (SELECT COUNT(*) FROM saved_trips WHERE user_id='account-delete-test' OR trip_id='trip-delete-test')=0 AND
 (SELECT COUNT(*) FROM saved_trips WHERE user_id='account-keep-test' AND trip_id='trip-keep-test')=1 AND
 (SELECT COUNT(*) FROM follows WHERE follower_id='account-delete-test' OR followed_id='account-delete-test')=0 AND
 (SELECT COUNT(*) FROM blocks WHERE blocker_id='account-delete-test' OR blocked_id='account-delete-test')=0 AND
 (SELECT COUNT(*) FROM reports WHERE reporter_id='account-delete-test')=0 AND
 (SELECT COUNT(*) FROM reports WHERE id='report-keep-test')=1 AND
 (SELECT COUNT(*) FROM travel_expenses WHERE user_id='account-delete-test' OR trip_id='trip-delete-test')=0 AND
 (SELECT COUNT(*) FROM travel_expenses WHERE id='expense-keep-test')=1 AND
 (SELECT COUNT(*) FROM auth_sessions WHERE user_id='account-delete-test')=0 AND
 (SELECT COUNT(*) FROM auth_sessions WHERE token_hash='session-keep-test')=1 AND
 (SELECT COUNT(*) FROM plan_imports WHERE claimed_by='account-delete-test')=0 AND
 (SELECT COUNT(*) FROM plan_imports WHERE id='import-keep-test')=1 AND
 (SELECT COUNT(*) FROM share_links WHERE owner_id='account-delete-test')=0 AND
 (SELECT COUNT(*) FROM share_links WHERE id='share-keep-test')=1
 THEN 'PASS' ELSE 'FAIL' END AS account_deletion_smoke_test;
