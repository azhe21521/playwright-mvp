## Playwright存在的问题
原始的 Playwright MCP 使用 `--extension` 模式时，会在本地启动 Chrome 并通过 loopback 地址与扩展建立 WebSocket 连接。这意味着 **MCP 服务和 Chrome 浏览器必须在同一台机器上**。

## Playwright-MVP预期设计
我希望设计一个中转服务，能够让运行在远端服务器上的 Playwright MCP 能够控制另一台物理机上的真实 Chrome 浏览器，打通两台机器的通信。

## Playwright-MVP设计思路
总体设计思路，可以参考下面的思路，依然使用Playwright原始的 Playwright MCP，但通过中转服务进行通信，远端机器运行MCP服务，我们希望在远端使用codebuddy或者cursor或者更一般的open claude作为MCP的客户端，连接到MCP后，调用Playwright的MCP服务时，通过ws长连接或者其他手段，先将调用转到中转服务，中转服务转发请求，利用vscode的端口转发，也就是ssh协议将请求转到本地物理机。本地物流机再转发请求到Chrome浏览器，Chrome浏览器再触发MCP服务。
这一块应该提供一个插件服务，安装到chrome浏览器，设计思路可以参考playwright原始项目下的extension代码实现，我们希望达到下面的预期。

## Playwright-MVP预期目标
1.能够使用token验证chrome浏览器和运行在远端的MCP服务之间的身份，达到身份校验的目的，token支持更改。
2.能够达到chrome和远端MCP服务之间的通信，达到通信的目的，实现双向通信。
3.开启chrome浏览器的白名单功能，只允许chrome浏览器访问白名单内的网址，然后执行例如截图等的tools的调用，不在白名单的网址一律拦截。
4.chrome插件支持查看远端MCP的健康状态，拥有的tools列表和简介。
5.支持chrome插件的配置，例如白名单、token等。
6.插件应提供私钥文件，使我能够发布插件。