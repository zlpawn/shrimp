# 💉 Spring Bean 自动注入与 @Transactional 事务规范

Leo Live Runner 通过 Spring 容器反射扫描与底层 AOP 动态代理机制，实现了对 Spring IoC 与事务体系的无感整合。

---

## 1. 成员变量自动注入规范 (Field Injection)

当动态类被编译实例化后，`SpringBeanInjector` 会扫描其所有声明字段，并执行以下匹配策略：

### 策略 1：零注解智能装配（最推荐 ⭐⭐⭐⭐⭐）
**无需添加任何注解，甚至无需 import 任何注解类！**
只要字段名称或类型能匹配到 Spring 容器中的 Bean，框架会自动反射注入：

```java
public class DynamicTask {
    // 自动匹配 Spring 中名为 "jdbcTemplate" 或类型为 JdbcTemplate 的 Bean
    private JdbcTemplate jdbcTemplate;

    // 自动匹配 Spring 中名为 "orderService" 或类型为 OrderService 的 Bean
    private OrderService orderService;

    // 自动匹配 Spring 中名为 "userMapper" 的 MyBatis Mapper Bean
    private UserMapper userMapper;

    // 自动匹配 Spring 中名为 "stringRedisTemplate" 的 Redis 客户端
    private StringRedisTemplate stringRedisTemplate;
}
```

### 策略 2：显式声明 `@Autowired` / `@Qualifier` / `@Resource`
如果你或 AI 习惯性保留了注解，框架 100% 兼容支持：

```java
import org.springframework.beans.factory.annotation.Autowired;

public class DynamicTask {
    @Autowired
    private OrderService orderService;

    // 按指定名称寻找特定数据源
    @Resource(name = "secondaryDataSource")
    private DataSource secondaryDs;
}
```

### 策略 3：同类型多候选 Bean 智能择优
当同一个接口/类在 Spring 容器中存在多个实现时（如多个数据源或策略类），`SpringBeanInjector` 会优先匹配与**字段名（fieldName）一致**的候选 Bean，若无精准同名则尝试 `@Primary` 候选，避免抛出 `NoUniqueBeanDefinitionException`。

---

## 2. 宿主工程已支持的基础设施与 ORM 体系

任何注册在宿主 Spring Boot 容器中的 Bean 均可直接注入并在动态代码中使用：

1. **MyBatis / MyBatis-Plus**：
   - `private UserMapper userMapper;`（支持 `userMapper.selectById()` 及 `Wrappers.lambdaQuery()`）
   - `private SqlSessionTemplate sqlSessionTemplate;`
2. **Spring Data JPA / Hibernate**：
   - `private UserRepository userRepository;`
   - `private EntityManager entityManager;`
3. **数据库连接与事务**：
   - `private JdbcTemplate jdbcTemplate;`
   - `private TransactionTemplate transactionTemplate;`
   - `private DataSource dataSource;`
4. **缓存与中间件**：
   - `private RedisTemplate<String, Object> redisTemplate;`
   - `private RabbitTemplate rabbitTemplate;`
   - `private KafkaTemplate<String, String> kafkaTemplate;`
5. **宿主工程业务 Service（强烈推荐）**：
   - `private OrderService orderService;`
   - `private AccountService accountService;`

---

## 3. 原生 `@Transactional` AOP 事务代理机制

动态类支持直接在类上或方法上打上 Spring 原生的 `@Transactional` 注解：

```java
import org.springframework.transaction.annotation.Transactional;

public class OrderRepairTask {
    private JdbcTemplate jdbcTemplate;

    // 引擎自动为此类创建 Spring CGLIB 事务 AOP 代理
    @Transactional(rollbackFor = Exception.class)
    public Object run(LiveLogger log) {
        log.println("步骤 1: 扣减金额...");
        jdbcTemplate.update("UPDATE t_account SET balance = balance - 100 WHERE id = 1");

        if (checkConditionFailed()) {
            // 抛出未捕获异常，Spring 事务拦截器自动 100% 回滚，不留脏数据！
            throw new RuntimeException("校验失败，触发事务回滚！");
        }

        return "COMMITTED";
    }
}
```

### 工作原理：
1. `SpringBeanInjector` 检测到类或方法包含 `@Transactional`；
2. 自动从宿主容器中获取 `PlatformTransactionManager`，通过 Spring 官方底层的 `ProxyFactory` 为原生对象织入 `TransactionInterceptor` 切面；
3. 执行期间一旦抛出异常，**所有涉及该数据源的 SQL 操作全部由 Spring 自动回滚**。

---

## 4. 🎯 方法形参自动注入与强类型自动映射

除了成员变量外，动态方法的形参同样支持智能注入与类型转换：

1. **`LiveLogger` 自动注入**：
   - 方法形参声明 `LiveLogger log`，引擎自动将当前执行的收集器注入，**无需在 HTTP 请求中传参**；
2. **`Map<String, Object>` 根上下文注入**：
   - 方法形参声明 `Map<String, Object> params`，若未指定对应 key，自动注入整个请求参数 Map；
3. **生产级强类型自动映射**：
   - **枚举（`Enum`）**：自动支持大小写不敏感匹配与数字序号匹配（如 `OrderStatusEnum.valueOf`）；
   - **日期时间（`Date` / `LocalDate` / `LocalDateTime` / `LocalTime`）**：自动将前端时间戳或 `"yyyy-MM-dd HH:mm:ss"` 字符串解析为强类型对象；
   - **集合与数组（`List<T>` / `Set<T>` / `Collection<T>`）**：支持 JSON 数组或逗号分隔字符串自动转换为对应集合；
   - **基础数值与布尔**：`Long`, `Integer`, `BigDecimal`, `BigInteger`, `Boolean` 等自动安全转换。
