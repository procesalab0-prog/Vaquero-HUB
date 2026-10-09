import importlib.util,json,tempfile,unittest,sqlite3
from pathlib import Path
spec=importlib.util.spec_from_file_location('recovery',Path.cwd()/'scripts/m9/woo-test/recovery.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Recovery(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.src=self.root/'runtime';(self.src/'private/worker-journal').mkdir(parents=True);(self.src/m.DB).parent.mkdir(parents=True);(self.src/'private/installed.json').write_text(json.dumps({'url':'http://127.0.0.1:9417'}));(self.src/'private/auth.json').write_text('LOCAL_FIXTURE_ONLY');(self.src/'wordpress/photo.jpg').write_bytes(b'fixture')
  with sqlite3.connect(self.src/m.DB) as c:c.execute('create table codes(code text)');c.execute("insert into codes values('0002396')")
 def tearDown(self):self.tmp.cleanup()
 def test_restore_data_and_permissions(self):
  backup=self.root/'backup';out=m.snapshot(self.src,backup);target=self.root/'restored';m.restore(backup,target,out['manifest_sha256']);self.assertEqual((target/'private/auth.json').stat().st_mode&0o777,0o600)
  with sqlite3.connect(target/m.DB) as c:self.assertEqual(c.execute('select code from codes').fetchone()[0],'0002396')
  self.assertEqual((target/'wordpress/photo.jpg').read_bytes(),b'fixture')
 def test_nonempty_destination_never_overwritten(self):
  dest=self.root/'existing';dest.mkdir();(dest/'keep').write_text('keep')
  with self.assertRaises(FileExistsError):m.snapshot(self.src,dest)
  self.assertEqual((dest/'keep').read_text(),'keep')
 def test_active_lock_rejected(self):
  (self.src/'private/worker-journal/a.lock').touch()
  with self.assertRaisesRegex(ValueError,'ACTIVE'):m.snapshot(self.src,self.root/'backup')
 def test_unresolved_job_rejected(self):
  (self.src/'private/worker-journal/a.json').write_text(json.dumps({'jobs':[{'state':'REVIEW_REQUIRED'}]}))
  with self.assertRaisesRegex(ValueError,'UNRESOLVED'):m.snapshot(self.src,self.root/'backup')
 def test_corrupt_photo_rejected_before_restore(self):
  backup=self.root/'backup';out=m.snapshot(self.src,backup);(backup/'wordpress/photo.jpg').write_bytes(b'corrupt')
  with self.assertRaisesRegex(ValueError,'FILE_HASH'):m.restore(backup,self.root/'target',out['manifest_sha256'])
  self.assertFalse((self.root/'target').exists())
 def test_untrusted_manifest_hash_rejected(self):
  backup=self.root/'backup';m.snapshot(self.src,backup)
  with self.assertRaisesRegex(ValueError,'MANIFEST_HASH'):m.restore(backup,self.root/'target','0'*64)
 def test_symlink_rejected(self):
  (self.src/'wordpress/external').symlink_to(self.src/'private/auth.json')
  with self.assertRaisesRegex(ValueError,'SYMLINK'):m.snapshot(self.src,self.root/'backup')
 def test_extra_backup_file_rejected(self):
  backup=self.root/'backup';out=m.snapshot(self.src,backup);(backup/'wordpress/extra.php').write_text('extra')
  with self.assertRaisesRegex(ValueError,'UNEXPECTED_FILES'):m.restore(backup,self.root/'target',out['manifest_sha256'])
if __name__=='__main__':unittest.main()
