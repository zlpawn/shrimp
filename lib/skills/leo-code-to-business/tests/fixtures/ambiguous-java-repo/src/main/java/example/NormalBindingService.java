package example;

public class NormalBindingService implements BindingService {
    private final BindingRepository repository;
    private final SearchIndex searchIndex;

    public NormalBindingService(BindingRepository repository, SearchIndex searchIndex) {
        this.repository = repository;
        this.searchIndex = searchIndex;
    }

    @Override
    public boolean bind(String projectId, String node) {
        repository.writeBinding(projectId, node, "BOUND");
        searchIndex.sync(projectId);
        return true;
    }
}
