const fs = require('fs');
const path = require('path');

const DEFAULT_LOCK_PATH = path.join(__dirname, '..', '.nya-build.lock');

function resolveLockPath(value) {
	if (!value) return DEFAULT_LOCK_PATH;
	return path.resolve(value);
}

function isProcessAlive(pid) {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	if (pid === process.pid) return true;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error.code === 'EPERM';
	}
}

function readLock(lockPath) {
	try {
		const raw = fs.readFileSync(lockPath, 'utf8').trim();
		const pid = Number.parseInt(raw.split(/[\s:]+/)[0], 10);
		return { pid: Number.isFinite(pid) ? pid : NaN, raw };
	} catch (error) {
		if (error.code === 'ENOENT') return null;
		throw error;
	}
}

function acquire(lockPath = DEFAULT_LOCK_PATH) {
	try {
		const fd = fs.openSync(lockPath, 'wx');
		try {
			fs.writeSync(fd, `${process.pid}\n`);
		} finally {
			fs.closeSync(fd);
		}
		return { ok: true, lockPath };
	} catch (error) {
		if (error.code !== 'EEXIST') throw error;

		const holder = readLock(lockPath);
		if (holder && !isProcessAlive(holder.pid)) {
			try {
				fs.unlinkSync(lockPath);
			} catch (unlinkError) {
				if (unlinkError.code !== 'ENOENT') throw unlinkError;
			}
			return acquire(lockPath);
		}

		return { ok: false, lockPath, holder };
	}
}

function release(lockPath = DEFAULT_LOCK_PATH) {
	try {
		const locked = readLock(lockPath);
		if (locked && locked.pid === process.pid) {
			fs.unlinkSync(lockPath);
		}
	} catch {
		// Lock already gone or unreadable; nothing to release.
	}
}

module.exports = { acquire, release, isProcessAlive, resolveLockPath };