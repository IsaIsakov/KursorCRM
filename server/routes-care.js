const express = require('express');
const db = require('./db');
const { authRequired } = require('./auth');
const { genId } = require('./util');

const router = express.Router();
router.use(authRequired);
function curator(req,res,next){ if(!['admin','assistant'].includes(req.user.role)) return res.status(403).json({error:'Доступно куратору или администратору'}); next(); }
function canReview(user,row){
  if(user.role==='admin') return true;
  return !!db.prepare(`SELECT 1 FROM students_crm sc LEFT JOIN group_members gm ON gm.student_id=sc.user_id
    LEFT JOIN groups g ON g.id=gm.group_id WHERE sc.user_id=? AND (sc.responsible_manager_id=? OR g.assistant_id=?) LIMIT 1`).get(row.student_id,user.id,user.id);
}

router.get('/care-requests',curator,(req,res)=>{
  const status=String(req.query.status||'pending');
  let rows=db.prepare(`SELECT fr.*,s.name AS student_name,p.name AS parent_name,sc.branch_id,b.name AS branch_name
    FROM freeze_requests fr JOIN users s ON s.id=fr.student_id JOIN users p ON p.id=fr.parent_id
    LEFT JOIN students_crm sc ON sc.user_id=fr.student_id LEFT JOIN branches b ON b.id=sc.branch_id
    WHERE fr.status=? ORDER BY fr.created_at DESC`).all(status);
  if(req.user.role!=='admin') rows=rows.filter(r=>canReview(req.user,r));
  res.json(rows);
});

router.put('/care-requests/:id/decision',curator,(req,res)=>{
  const row=db.prepare('SELECT * FROM freeze_requests WHERE id=?').get(req.params.id);
  if(!row) return res.status(404).json({error:'Заявка не найдена'});
  if(!canReview(req.user,row)) return res.status(403).json({error:'Заявка не относится к вашим ученикам'});
  if(row.status!=='pending') return res.status(409).json({error:'Заявка уже обработана'});
  const approved=req.body?.approved===true, comment=String(req.body?.comment||'').trim().slice(0,1000), now=Date.now();
  db.transaction(()=>{
    db.prepare(`UPDATE freeze_requests SET status=?,reviewed_by=?,review_comment=?,reviewed_at=?,updated_at=? WHERE id=?`)
      .run(approved?'approved':'rejected',req.user.id,comment||null,now,now,row.id);
    if(approved){
      const sub=db.prepare("SELECT * FROM subscriptions WHERE student_id=? AND status IN ('active','frozen') ORDER BY created_at DESC LIMIT 1").get(row.student_id);
      if(sub){
        db.prepare(`INSERT INTO subscription_freezes(id,subscription_id,starts_at,ends_at,reason,created_by,created_at) VALUES (?,?,?,?,?,?,?)`)
          .run(genId('frz'),sub.id,row.starts_at,row.ends_at,row.reason,req.user.id,now);
        if(sub.expires_at) db.prepare('UPDATE subscriptions SET expires_at=expires_at+? WHERE id=?').run(Math.max(0,row.ends_at-row.starts_at),sub.id);
      }
    }
    const text=approved?'Заявка на заморозку одобрена':'Заявка на заморозку отклонена';
    db.prepare(`INSERT INTO notifications(id,user_id,type,text,link,channel,read,created_at) VALUES (?,?, 'freeze_decision', ?, '/pages/parent.html', 'in_app',0,?)`)
      .run(genId('ntf'),row.parent_id,comment?`${text}: ${comment}`:text,now);
  })();
  res.json(db.prepare('SELECT * FROM freeze_requests WHERE id=?').get(row.id));
});

router.get('/absence-notices',curator,(req,res)=>{
  const from=Number(req.query.from)||Date.now()-7*86400000,to=Number(req.query.to)||Date.now()+60*86400000;
  let rows=db.prepare(`SELECT an.*,s.name AS student_name,p.name AS parent_name,g.name AS group_name,g.branch_id
    FROM absence_notices an JOIN users s ON s.id=an.student_id JOIN users p ON p.id=an.parent_id JOIN groups g ON g.id=an.group_id
    WHERE an.lesson_at BETWEEN ? AND ? AND an.status!='cancelled' ORDER BY an.lesson_at`).all(from,to);
  if(req.user.role!=='admin') rows=rows.filter(r=>canReview(req.user,r));
  res.json(rows);
});

module.exports=router;
