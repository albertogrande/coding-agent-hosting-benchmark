class TasksController < ApplicationController
  before_action :require_user

  def index
    @tasks = current_user.tasks.order(:created_at)
    @task = Task.new
  end

  def show
    @task = Task.find(params[:id])
    @comments = @task.comments.includes(:author).order(:created_at)
  end

  def create
    current_user.tasks.create!(params.expect(task: [:title]))
    redirect_to tasks_path
  end

  def complete
    current_user.tasks.find(params[:id]).update!(done: true, done_at: Time.current)
    redirect_to tasks_path
  end
end
