// 单进程跑全部测试。
// 为什么不用 `node --test`：它会把每个测试文件 spawn 成子进程，本机沙箱禁止子进程管道（EPERM）。
// 用法：node temp/build 之后执行 `node test/index.mjs`（见 package.json 的 test 脚本）。
import './settlement.test.mjs';
import './turn.test.mjs';
import './combat.test.mjs';
import './rescue.test.mjs';
import './hooks.test.mjs';
import './victory.test.mjs';
import './game.test.mjs';
import './dying.test.mjs';
import './match.test.mjs';
import './bp.test.mjs';
