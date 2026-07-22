const express = require('express');
const db = require('./db');
const { authRequired, requireRole } = require('./auth');
const { genId } = require('./util');
const ws = require('./ws');

const router = express.Router();
router.use(authRequired);

function activeMember(userId, groupId) {
  const now = Date.now();
  return !!db.prepare(`SELECT 1 FROM group_members
    WHERE student_id=? AND group_id=? AND since<=? AND (until IS NULL OR until>=?)`).get(userId, groupId, now, now)
    || !!db.prepare("SELECT 1 FROM users WHERE id=? AND role='student' AND group_id=?").get(userId, groupId);
}
function groupAccess(user, groupId) {
  const g = db.prepare('SELECT id,name,teacher_id,status FROM groups WHERE id=?').get(groupId);
  if (!g || g.status !== 'active') return null;
  if (user.role === 'teacher' && g.teacher_id === user.id) return g;
  if (user.role === 'student' && activeMember(user.id, groupId)) return g;
  return null;
}
function groupRecipients(groupId) {
  const now = Date.now();
  return db.prepare(`SELECT teacher_id AS id FROM groups WHERE id=? AND teacher_id IS NOT NULL
    UNION SELECT student_id AS id FROM group_members WHERE group_id=? AND since<=? AND (until IS NULL OR until>=?)
    UNION SELECT id FROM users WHERE role='student' AND group_id=?`).all(groupId, groupId, now, now, groupId).map(r => r.id);
}
function publicMessage(r) {
  return { id:r.id, body:r.body, createdAt:r.created_at, sender:{ id:r.sender_id, name:r.sender_name, role:r.sender_role, avatarUrl:r.avatar_url || null } };
}
function markRead(userId, type, id) {
  db.prepare(`INSERT INTO chat_read_state(user_id,channel_type,channel_id,read_at) VALUES (?,?,?,?)
    ON CONFLICT(user_id,channel_type,channel_id) DO UPDATE SET read_at=excluded.read_at`).run(userId,type,id,Date.now());
}
function bodyText(req, res) {
  const body = String(req.body?.body || '').trim();
  if (!body || body.length > 4000) { res.status(400).json({ error:'Сообщение должно содержать от 1 до 4000 символов' }); return null; }
  return body;
}

router.get('/chats', requireRole('teacher','student','parent'), (req,res) => {
  if (req.user.role === 'parent') {
    const rows = db.prepare(`SELECT t.*, s.name student_name, u.name teacher_name,
      (SELECT body FROM parent_teacher_messages WHERE thread_id=t.id ORDER BY created_at DESC LIMIT 1) last_message,
      (SELECT created_at FROM parent_teacher_messages WHERE thread_id=t.id ORDER BY created_at DESC LIMIT 1) last_at,
      (SELECT COUNT(*) FROM parent_teacher_messages m LEFT JOIN chat_read_state rs ON rs.user_id=? AND rs.channel_type='parent_thread' AND rs.channel_id=t.id
       WHERE m.thread_id=t.id AND m.sender_id<>? AND m.created_at>COALESCE(rs.read_at,0)) unread
      FROM parent_teacher_threads t JOIN users s ON s.id=t.student_id JOIN users u ON u.id=t.teacher_id
      WHERE t.parent_id=? ORDER BY t.updated_at DESC`).all(req.user.id,req.user.id,req.user.id);
    const contacts = db.prepare(`SELECT DISTINCT s.id student_id,s.name student_name,g.id group_id,g.name group_name,t.id teacher_id,t.name teacher_name
      FROM parent_children pc JOIN users s ON s.id=pc.student_id
      JOIN group_members gm ON gm.student_id=s.id JOIN groups g ON g.id=gm.group_id JOIN users t ON t.id=g.teacher_id
      WHERE pc.parent_id=? AND g.status='active' AND gm.since<=? AND (gm.until IS NULL OR gm.until>=?)
      UNION SELECT DISTINCT s.id,s.name,g.id,g.name,t.id,t.name FROM parent_children pc JOIN users s ON s.id=pc.student_id
      JOIN groups g ON g.id=s.group_id JOIN users t ON t.id=g.teacher_id
      WHERE pc.parent_id=? AND g.status='active' ORDER BY student_name,group_name`).all(req.user.id,Date.now(),Date.now(),req.user.id);
    return res.json({ groups:[], threads:rows.map(threadRow), contacts:contacts.map(r=>({studentId:r.student_id,studentName:r.student_name,groupId:r.group_id,groupName:r.group_name,teacherId:r.teacher_id,teacherName:r.teacher_name})) });
  }
  if (req.user.role === 'student') {
    const now=Date.now();
    const groups=db.prepare(`SELECT DISTINCT g.id,g.name,t.name teacher_name,
      (SELECT body FROM group_chat_messages WHERE group_id=g.id AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1) last_message,
      (SELECT created_at FROM group_chat_messages WHERE group_id=g.id AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1) last_at,
      (SELECT COUNT(*) FROM group_chat_messages m LEFT JOIN chat_read_state rs ON rs.user_id=? AND rs.channel_type='group' AND rs.channel_id=g.id
       WHERE m.group_id=g.id AND m.deleted_at IS NULL AND m.sender_id<>? AND m.created_at>COALESCE(rs.read_at,0)) unread
      FROM groups g LEFT JOIN users t ON t.id=g.teacher_id LEFT JOIN group_members gm ON gm.group_id=g.id
      WHERE g.status='active' AND ((gm.student_id=? AND gm.since<=? AND (gm.until IS NULL OR gm.until>=?)) OR g.id=?) ORDER BY g.name`)
      .all(req.user.id,req.user.id,req.user.id,now,now,req.user.group || '');
    const threads=db.prepare(`SELECT t.*,u.name teacher_name,
      (SELECT body FROM student_teacher_messages WHERE thread_id=t.id ORDER BY created_at DESC LIMIT 1) last_message,
      (SELECT created_at FROM student_teacher_messages WHERE thread_id=t.id ORDER BY created_at DESC LIMIT 1) last_at,
      (SELECT COUNT(*) FROM student_teacher_messages WHERE thread_id=t.id AND sender_id<>? AND read_at IS NULL) unread
      FROM student_teacher_threads t JOIN users u ON u.id=t.teacher_id
      WHERE t.student_id=? ORDER BY t.updated_at DESC`).all(req.user.id,req.user.id);
    const contacts=db.prepare(`SELECT DISTINCT t.id teacher_id,t.name teacher_name,g.id group_id,g.name group_name
      FROM groups g JOIN users t ON t.id=g.teacher_id LEFT JOIN group_members gm ON gm.group_id=g.id
      WHERE g.status='active' AND ((gm.student_id=? AND gm.since<=? AND (gm.until IS NULL OR gm.until>=?)) OR g.id=?)
      ORDER BY t.name,g.name`).all(req.user.id,now,now,req.user.group||'');
    return res.json({groups,threads:[],studentThreads:threads.map(studentThreadRow),contacts:contacts.map(r=>({teacherId:r.teacher_id,teacherName:r.teacher_name,groupId:r.group_id,groupName:r.group_name}))});
  }
  const groups=db.prepare(`SELECT g.id,g.name,u.name teacher_name,
    (SELECT body FROM group_chat_messages WHERE group_id=g.id AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1) last_message,
    (SELECT created_at FROM group_chat_messages WHERE group_id=g.id AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1) last_at,
    (SELECT COUNT(*) FROM group_chat_messages m LEFT JOIN chat_read_state rs ON rs.user_id=? AND rs.channel_type='group' AND rs.channel_id=g.id
     WHERE m.group_id=g.id AND m.deleted_at IS NULL AND m.sender_id<>? AND m.created_at>COALESCE(rs.read_at,0)) unread
    FROM groups g LEFT JOIN users u ON u.id=g.teacher_id WHERE g.teacher_id=? AND g.status='active' ORDER BY g.name`).all(req.user.id,req.user.id,req.user.id);
  const threads=db.prepare(`SELECT t.*,s.name student_name,u.name teacher_name,p.name parent_name,
    (SELECT body FROM parent_teacher_messages WHERE thread_id=t.id ORDER BY created_at DESC LIMIT 1) last_message,
    (SELECT created_at FROM parent_teacher_messages WHERE thread_id=t.id ORDER BY created_at DESC LIMIT 1) last_at,
    (SELECT COUNT(*) FROM parent_teacher_messages m LEFT JOIN chat_read_state rs ON rs.user_id=? AND rs.channel_type='parent_thread' AND rs.channel_id=t.id
     WHERE m.thread_id=t.id AND m.sender_id<>? AND m.created_at>COALESCE(rs.read_at,0)) unread
    FROM parent_teacher_threads t JOIN users s ON s.id=t.student_id JOIN users u ON u.id=t.teacher_id JOIN users p ON p.id=t.parent_id
    WHERE t.teacher_id=? ORDER BY t.updated_at DESC`).all(req.user.id,req.user.id,req.user.id);
  const studentThreads=db.prepare(`SELECT t.*,s.name student_name,u.name teacher_name,
    (SELECT body FROM student_teacher_messages WHERE thread_id=t.id ORDER BY created_at DESC LIMIT 1) last_message,
    (SELECT created_at FROM student_teacher_messages WHERE thread_id=t.id ORDER BY created_at DESC LIMIT 1) last_at,
    (SELECT COUNT(*) FROM student_teacher_messages WHERE thread_id=t.id AND sender_id<>? AND read_at IS NULL) unread
    FROM student_teacher_threads t JOIN users s ON s.id=t.student_id JOIN users u ON u.id=t.teacher_id
    WHERE t.teacher_id=? ORDER BY t.updated_at DESC`).all(req.user.id,req.user.id);
  res.json({groups,threads:threads.map(threadRow),studentThreads:studentThreads.map(studentThreadRow)});
});

function threadRow(r){ return {id:r.id,subject:r.subject,studentId:r.student_id,studentName:r.student_name,teacherId:r.teacher_id,teacherName:r.teacher_name,parentName:r.parent_name||null,lastMessage:r.last_message||null,lastAt:r.last_at||null,unread:Number(r.unread)||0,closedAt:r.closed_at||null}; }
function studentThreadRow(r){return {id:r.id,subject:r.subject,studentId:r.student_id,studentName:r.student_name||null,teacherId:r.teacher_id,teacherName:r.teacher_name,lastMessage:r.last_message||null,lastAt:r.last_at||null,unread:Number(r.unread)||0,closedAt:r.closed_at||null}}

router.get('/chats/groups/:groupId/messages', requireRole('teacher','student'), (req,res) => {
  const g=groupAccess(req.user,req.params.groupId); if(!g) return res.status(403).json({error:'Нет доступа к чату группы'});
  const before=Math.min(Number(req.query.before)||Date.now()+1,Date.now()+86400000);
  const rows=db.prepare(`SELECT m.*,u.name sender_name,u.role sender_role,u.avatar_url FROM group_chat_messages m JOIN users u ON u.id=m.sender_id
    WHERE m.group_id=? AND m.deleted_at IS NULL AND m.created_at<? ORDER BY m.created_at DESC LIMIT 100`).all(g.id,before).reverse();
  markRead(req.user.id,'group',g.id); res.json({channel:{id:g.id,name:g.name},messages:rows.map(publicMessage)});
});

router.post('/chats/groups/:groupId/messages', requireRole('teacher','student'), (req,res) => {
  const g=groupAccess(req.user,req.params.groupId); if(!g) return res.status(403).json({error:'Нет доступа к чату группы'});
  const body=bodyText(req,res); if(body===null)return;
  const id=genId('gmsg'),now=Date.now(); db.prepare('INSERT INTO group_chat_messages(id,group_id,sender_id,body,created_at) VALUES (?,?,?,?,?)').run(id,g.id,req.user.id,body,now);
  const row=db.prepare(`SELECT m.*,u.name sender_name,u.role sender_role,u.avatar_url FROM group_chat_messages m JOIN users u ON u.id=m.sender_id WHERE m.id=?`).get(id);
  const message=publicMessage(row); markRead(req.user.id,'group',g.id); ws.broadcastToUsers(groupRecipients(g.id),{type:'chat_message',channelType:'group',channelId:g.id,message});
  res.status(201).json(message);
});

router.post('/chats/parent-threads', requireRole('parent'), (req,res) => {
  const studentId=String(req.body?.studentId||''),teacherId=String(req.body?.teacherId||''),subject=String(req.body?.subject||'Вопрос преподавателю').trim();
  if(!db.prepare('SELECT 1 FROM parent_children WHERE parent_id=? AND student_id=?').get(req.user.id,studentId)) return res.status(403).json({error:'Это не ваш ребёнок'});
  if(!subject||subject.length>160)return res.status(400).json({error:'Тема должна содержать от 1 до 160 символов'});
  const teacher=db.prepare(`SELECT g.teacher_id id FROM groups g JOIN group_members gm ON gm.group_id=g.id WHERE gm.student_id=? AND g.teacher_id=? AND g.status='active' AND gm.since<=? AND (gm.until IS NULL OR gm.until>=?) LIMIT 1`).get(studentId,teacherId,Date.now(),Date.now())
    || db.prepare(`SELECT g.teacher_id id FROM users s JOIN groups g ON g.id=s.group_id WHERE s.id=? AND g.teacher_id=? AND g.status='active'`).get(studentId,teacherId);
  if(!teacher)return res.status(409).json({error:'У ребёнка пока не назначен преподаватель'});
  const id=genId('pth'),now=Date.now(); db.prepare('INSERT INTO parent_teacher_threads(id,parent_id,student_id,teacher_id,subject,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(id,req.user.id,studentId,teacher.id,subject,now,now);
  res.status(201).json({id,teacherId:teacher.id,studentId,subject});
});

function getThread(user,id){const t=db.prepare('SELECT * FROM parent_teacher_threads WHERE id=?').get(id);if(!t)return null;if(user.role==='parent'&&t.parent_id===user.id)return t;if(user.role==='teacher'&&t.teacher_id===user.id)return t;return null;}
router.get('/chats/parent-threads/:id/messages', requireRole('teacher','parent'), (req,res)=>{const t=getThread(req.user,req.params.id);if(!t)return res.status(403).json({error:'Нет доступа к диалогу'});const rows=db.prepare(`SELECT m.*,u.name sender_name,u.role sender_role,u.avatar_url FROM parent_teacher_messages m JOIN users u ON u.id=m.sender_id WHERE m.thread_id=? ORDER BY m.created_at LIMIT 200`).all(t.id);markRead(req.user.id,'parent_thread',t.id);db.prepare('UPDATE parent_teacher_messages SET read_at=? WHERE thread_id=? AND sender_id<>? AND read_at IS NULL').run(Date.now(),t.id,req.user.id);res.json({messages:rows.map(publicMessage)});});
router.post('/chats/parent-threads/:id/messages', requireRole('teacher','parent'), (req,res)=>{const t=getThread(req.user,req.params.id);if(!t)return res.status(403).json({error:'Нет доступа к диалогу'});if(t.closed_at)return res.status(409).json({error:'Диалог закрыт'});const body=bodyText(req,res);if(body===null)return;const id=genId('pmsg'),now=Date.now();db.prepare('INSERT INTO parent_teacher_messages(id,thread_id,sender_id,body,created_at) VALUES (?,?,?,?,?)').run(id,t.id,req.user.id,body,now);db.prepare('UPDATE parent_teacher_threads SET updated_at=? WHERE id=?').run(now,t.id);const row=db.prepare(`SELECT m.*,u.name sender_name,u.role sender_role,u.avatar_url FROM parent_teacher_messages m JOIN users u ON u.id=m.sender_id WHERE m.id=?`).get(id);const message=publicMessage(row);markRead(req.user.id,'parent_thread',t.id);ws.broadcastToUsers([t.parent_id,t.teacher_id],{type:'chat_message',channelType:'parent_thread',channelId:t.id,message});res.status(201).json(message);});

router.post('/chats/student-threads', requireRole('student'), (req,res)=>{
  const teacherId=String(req.body?.teacherId||''),subject=String(req.body?.subject||'Вопрос преподавателю').trim(),now=Date.now();
  if(!subject||subject.length>160)return res.status(400).json({error:'Тема должна содержать от 1 до 160 символов'});
  const teacher=db.prepare(`SELECT g.teacher_id id FROM groups g LEFT JOIN group_members gm ON gm.group_id=g.id
    WHERE g.teacher_id=? AND g.status='active' AND ((gm.student_id=? AND gm.since<=? AND (gm.until IS NULL OR gm.until>=?)) OR g.id=?) LIMIT 1`)
    .get(teacherId,req.user.id,now,now,req.user.group||'');
  if(!teacher)return res.status(403).json({error:'Можно написать только своему преподавателю'});
  const existing=db.prepare('SELECT id FROM student_teacher_threads WHERE student_id=? AND teacher_id=? AND closed_at IS NULL ORDER BY updated_at DESC LIMIT 1').get(req.user.id,teacherId);
  if(existing)return res.json({id:existing.id,reused:true});
  const id=genId('sth');db.prepare('INSERT INTO student_teacher_threads(id,student_id,teacher_id,subject,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(id,req.user.id,teacherId,subject,now,now);
  res.status(201).json({id,teacherId,studentId:req.user.id,subject});
});
function getStudentThread(user,id){const t=db.prepare('SELECT * FROM student_teacher_threads WHERE id=?').get(id);if(!t)return null;if(user.role==='student'&&t.student_id===user.id)return t;if(user.role==='teacher'&&t.teacher_id===user.id)return t;return null}
router.get('/chats/student-threads/:id/messages',requireRole('teacher','student'),(req,res)=>{const t=getStudentThread(req.user,req.params.id);if(!t)return res.status(403).json({error:'Нет доступа к диалогу'});const rows=db.prepare(`SELECT m.*,u.name sender_name,u.role sender_role,u.avatar_url FROM student_teacher_messages m JOIN users u ON u.id=m.sender_id WHERE m.thread_id=? ORDER BY m.created_at LIMIT 200`).all(t.id);db.prepare('UPDATE student_teacher_messages SET read_at=? WHERE thread_id=? AND sender_id<>? AND read_at IS NULL').run(Date.now(),t.id,req.user.id);res.json({messages:rows.map(publicMessage)});});
router.post('/chats/student-threads/:id/messages',requireRole('teacher','student'),(req,res)=>{const t=getStudentThread(req.user,req.params.id);if(!t)return res.status(403).json({error:'Нет доступа к диалогу'});if(t.closed_at)return res.status(409).json({error:'Диалог закрыт'});const body=bodyText(req,res);if(body===null)return;const id=genId('smsg'),now=Date.now();db.prepare('INSERT INTO student_teacher_messages(id,thread_id,sender_id,body,created_at) VALUES (?,?,?,?,?)').run(id,t.id,req.user.id,body,now);db.prepare('UPDATE student_teacher_threads SET updated_at=? WHERE id=?').run(now,t.id);const row=db.prepare(`SELECT m.*,u.name sender_name,u.role sender_role,u.avatar_url FROM student_teacher_messages m JOIN users u ON u.id=m.sender_id WHERE m.id=?`).get(id);const message=publicMessage(row);ws.broadcastToUsers([t.student_id,t.teacher_id],{type:'chat_message',channelType:'student_thread',channelId:t.id,message});res.status(201).json(message);});

module.exports=router;
