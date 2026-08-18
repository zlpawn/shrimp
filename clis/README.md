# 🚀 自研 CLI 工具开发与结构规范指南 (In-Repo Custom CLI Guide)

本文档作为**所有 AI 编码助手（如 Antigravity / Claude / Cursor / Codex）及人类开发者**在当前项目中创建与维护自研 CLI（命令行工具）的**唯一标准规范**。

---

## 📌 一、 核心设计理念与自治原则

1. **统一仓库维护（Monorepo）**：所有自研 CLI 源码均存放于 `clis/<cli-name>/` 目录下，与网关在同一个 Git 仓库中协同管理。
2. **🛡️ 100% 零耦合独立运行（Decoupled Standalone）**：
   - **每个 CLI 都是一个完全自治的独立子工程**；
   - **严禁依赖或 import 网关内部源码**（如 `lib/`、`server.js` 等）；
   - 即使网关未启动或彻底移除，任何一个 CLI 文件夹被单独拷贝到其他电脑、服务器、CI/CD 流程中，均可 100% 独立运行。
3. **双层运行架构（Dev 源码热执行 + Global 全局免前缀分发）**：
   - **开发态（Dev Mode）**：修改源码无需编译，通过对应语言引擎直接即改即测；
   - **发布/使用态（Global Mode）**：支持注册为全局 PATH 垫片（Shim）或打包为免依赖的独立单文件二进制（Native Binary）。

---

## 📁 二、 目录结构与多语言入口规范

当你在 `clis/` 目录下新建子文件夹时，网关的「系统扩展 - 本机 CLI」会自动探测并展示其命令与状态。请遵循以下主流语言的文件命名规范：

### 1. Java JBang 自研 CLI（⭐ 极力推荐）

- **推荐目录结构**：
  ```text
  clis/my-java-cli/
  ├── README.md             # 工具说明与参数文档
  └── App.java              # 单文件 Java CLI (或 Main.java / Cli.java)
  ```
- **开发与依赖声明**：
  在 `App.java` 头部通过 `//DEPS` 注释内嵌声明依赖（如终端解析库 `picocli`），由 JBang 自动下载并缓存：
  ```java
  ///usr/bin/env jbang "$0" "$@" ; exit $?
  //JAVA 17+
  //DEPS info.picocli:picocli:4.7.6

  import picocli.CommandLine;
  import picocli.CommandLine.Command;
  import picocli.CommandLine.Option;
  import java.util.concurrent.Callable;

  @Command(name = "my-java-cli", mixinStandardHelpOptions = true, version = "1.0",
           description = "自研 Java JBang CLI 工具")
  public class App implements Callable<Integer> {
      @Option(names = {"-n", "--name"}, defaultValue = "World", description = "问候名称")
      private String name;

      @Override
      public Integer call() {
          System.out.println("Hello, " + name + "!");
          return 0;
      }

      public static void main(String... args) {
          int exitCode = new CommandLine(new App()).execute(args);
          System.exit(exitCode);
      }
  }
  ```
- **网关感知规则**：
  - 若存在 `App.java`、`Main.java`、`*.java`；
  - 自动识别为 **Java (JBang) CLI**；
  - 开发态调度命令：`jbang ./clis/<cli-name>/App.java`；
  - 独立二进制导出：`jbang export native ./clis/<cli-name>/App.java -O bin/<cli-name>.exe`。

---

### 2. Python (uv 隔离) 自研 CLI

- **推荐目录结构**：
  ```text
  clis/my-py-cli/
  ├── pyproject.toml        # 或 requirements.txt (声明依赖)
  ├── README.md
  └── cli.py                # 入口脚本 (或 main.py / app.py)
  ```
- **网关感知规则**：
  - 若存在 `cli.py`、`main.py`、`app.py` 或 `pyproject.toml`；
  - 自动识别为 **Python (uv) CLI**；
  - 开发态调度命令：`uv run --directory ./clis/<cli-name> cli.py`；
  - 独立单文件打包：可使用 `pyinstaller --onefile ./clis/<cli-name>/cli.py`。

---

### 3. Node.js 自研 CLI

- **推荐目录结构**：
  ```text
  clis/my-node-cli/
  ├── package.json          # 声明独立依赖与 bin 入口
  ├── README.md
  └── index.mjs             # 入口文件 (或 cli.mjs / index.js)
  ```
- **网关感知规则**：
  - 若存在 `index.mjs`、`cli.mjs`、`index.js` 或 `package.json`；
  - 自动识别为 **Node.js CLI**；
  - 开发态调度命令：`node ./clis/<cli-name>/index.mjs`；
  - 独立单文件打包：可使用 `bun build --compile ./clis/<cli-name>/index.mjs --outfile bin/<cli-name>.exe`。

---

### 4. Go 高性能自研 CLI

- **推荐目录结构**：
  ```text
  clis/my-go-cli/
  ├── go.mod                # 声明 module
  ├── README.md
  └── main.go               # 入口源码
  ```
- **网关感知规则**：
  - 若存在 `go.mod`、`main.go`；
  - 自动识别为 **Go CLI**；
  - 开发态调度命令：`go run ./clis/<cli-name>/main.go`；
  - 原生编译：`go build -o bin/<cli-name>.exe ./clis/<cli-name>`。

---

## 🛠️ 三、 新建自研 CLI 的标准工作流

### 给 AI 助手 / 开发者的操作指令：

1. **新建子目录**：在 `clis/` 下创建你的 CLI 名称目录，如 `clis/csv-exporter/`；
2. **编写代码与依赖**：
   - 依照上述语言规范创建入口文件（如 `App.java`、`cli.py` 或 `index.mjs`）；
   - 实现标准命令行参数解析（支持 `--help` 与 `--version`）；
   - **务必保证完全不引用网关项目代码**；
3. **打开网关面板**：
   - 进入 **「系统扩展 -> 本机 CLI」**；
   - 页面上方 **「🚀 本地自研 / 网关托管 CLI」** 列表中会自动实时出现该工具卡片，展示其语言徽标、源码路径与执行命令；
4. **终端直接调用**：
   - 在终端使用对应引擎直接运行源码；
   - 或注册到系统 PATH 垫片实现全局免前缀敲命令运行！
